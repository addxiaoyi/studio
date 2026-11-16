import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  inspectLegacyDowngrade,
  validateLoopbackDatabaseUrl,
} from "./legacy-downgrade-guard.mjs";

const columns = {
  background_jobs: {
    job_type: "text",
    billing_required: "boolean",
    billing_receipt: "jsonb",
    billing_pricing: "jsonb",
    settlement_review: "jsonb",
    billing_approval_id: "uuid",
    cancel_requested_at: "timestamp with time zone",
  },
  credit_transactions: { transaction_type: "text" },
  generation_approvals: {
    workspace_id: "uuid",
    user_id: "uuid",
    job_type: "text",
    model: "text",
    payload_fingerprint: "text",
    status: "text",
    context: "jsonb",
    billing_pricing: "jsonb",
  },
  project_user_contexts: { view: "text" },
};

function fixture(schema = columns, answers = {}) {
  const queries = [];
  const snapshot = { observed_at: "2026-11-16T12:00:00Z", read_only: "on" };
  const catalog = Object.entries(schema).flatMap(([table, fields]) =>
    Object.entries(fields).map(([name, type]) => ({
      table_name: table,
      relation_kind: "r",
      column_name: name,
      data_type: type,
      row_security_active: false,
    })),
  );
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.startsWith("select transaction_timestamp"))
        return { rows: [snapshot] };
      if (sql.includes("pg_catalog.pg_class")) return { rows: catalog };
      const check = /\/\* downgrade:([a-z_]+) \*\//.exec(sql)?.[1];
      return { rows: check ? [{ count: answers[check] ?? "0" }] : [] };
    },
  };
  return { client, queries, snapshot, catalog };
}

test("accepts an empty migrated snapshot while confirming read-only isolation", async () => {
  const f = fixture();
  const report = await inspectLegacyDowngrade({ client: f.client });
  assert.equal(report.readOnly, true);
  assert.equal(report.downgrade, "no_blockers_observed");
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.coverage.absent, []);
  assert.equal(report.tables.background_jobs.state, "checked");
  assert.equal(report.tables.project_user_contexts.state, "checked");
  assert.equal(report.schema, "public");
  assert.match(f.queries[0].sql, /repeatable read, read only/);
  assert.equal(f.queries.at(-1).sql, "commit");
  const catalog = f.queries.find(({ sql }) =>
    sql.includes("pg_catalog.pg_class"),
  );
  assert.deepEqual(catalog.values, ["public", Object.keys(columns)]);
  for (const { sql } of f.queries) {
    assert.match(sql, /^(begin|set local|select|commit|\/\* downgrade:)/i);
    assert.doesNotMatch(
      sql,
      /\b(insert|update|delete|truncate|alter|create|drop)\b/i,
    );
    assert.doesNotMatch(sql, /select\s+\*/i);
  }
});

test("blocks each new generation invariant even on terminal or refunded cancelled jobs", async () => {
  const names = [
    "billing_required",
    "billing_receipt",
    "billing_pricing",
    "settlement_review",
    "billing_approval_id",
    "cancel_requested_at",
  ];
  for (const field of names) {
    const code = `generation_${field}`;
    const f = fixture(columns, { [code]: "2" });
    const report = await inspectLegacyDowngrade({ client: f.client });
    assert.deepEqual(report.blockers, [
      { table: "background_jobs", code, count: 2 },
    ]);
    assert.equal(report.downgrade, "blocked");
    const check = f.queries.find(({ sql }) =>
      sql.includes(`downgrade:${code}`),
    );
    assert.match(
      check.sql,
      /"job_type" in \('image_generation','video_generation'\)/,
    );
    assert.doesNotMatch(
      check.sql,
      /status|started_at|attempt_count|generation_refund/,
    );
    assert.match(
      check.sql,
      new RegExp(
        `"${field}" ${field === "billing_required" ? "is true" : "is not null"}`,
      ),
    );
  }
});

test("blocks adjustment rows regardless of sign and approval pricing snapshots", async () => {
  const f = fixture(columns, {
    generation_adjustments: "2",
    approval_billing_pricing: "1",
  });
  const report = await inspectLegacyDowngrade({ client: f.client });
  assert.deepEqual(report.blockers, [
    { table: "credit_transactions", code: "generation_adjustments", count: 2 },
    {
      table: "generation_approvals",
      code: "approval_billing_pricing",
      count: 1,
    },
  ]);
  const ledger = f.queries.find(({ sql }) =>
    sql.includes("downgrade:generation_adjustments"),
  );
  assert.match(ledger.sql, /"transaction_type"='generation_adjustment'/);
  assert.doesNotMatch(ledger.sql, /amount|created_at|job_id/);
});

test("checks exact legacy pending-approval scope and only reports conflicting group counts", async () => {
  const f = fixture(columns, {
    approval_pending_old_key_duplicates: "3",
    approval_extra_context: "4",
  });
  const report = await inspectLegacyDowngrade({ client: f.client });
  assert.deepEqual(
    report.blockers.map(({ code, count }) => [code, count]),
    [
      ["approval_pending_old_key_duplicates", 3],
      ["approval_extra_context", 4],
    ],
  );
  const duplicate = f.queries.find(({ sql }) =>
    sql.includes("downgrade:approval_pending_old_key_duplicates"),
  );
  for (const key of [
    "workspace_id",
    "user_id",
    "job_type",
    "model",
    "payload_fingerprint",
  ])
    assert(duplicate.sql.includes(`"${key}"`));
  assert.match(duplicate.sql, /coalesce\("context"->>'canvasId',''\)/);
  assert.match(duplicate.sql, /coalesce\("context"->>'sessionId',''\)/);
  assert.match(duplicate.sql, /"status"='pending'/);
  assert.match(duplicate.sql, /having count\(\*\)>1/);
  const extra = f.queries.find(({ sql }) =>
    sql.includes("downgrade:approval_extra_context"),
  );
  assert.match(extra.sql, /"context" - 'canvasId' - 'sessionId'/);
  assert.doesNotMatch(extra.sql, /"status"=/);
  assert(!JSON.stringify(report).includes("workspace_id_value"));
});

test("blocks fitting rows without returning user or project identities", async () => {
  const f = fixture(columns, { project_fitting_views: "5" });
  const report = await inspectLegacyDowngrade({ client: f.client });
  assert.deepEqual(report.blockers, [
    { table: "project_user_contexts", code: "project_fitting_views", count: 5 },
  ]);
  const check = f.queries.find(({ sql }) =>
    sql.includes("downgrade:project_fitting_views"),
  );
  assert.match(check.sql, /"view"='fitting'/);
  assert.doesNotMatch(check.sql, /user_id|project_id/);
});

test("allows migration columns not yet present and records every unavailable check", async () => {
  const legacy = {
    ...columns,
    background_jobs: { job_type: "text" },
    generation_approvals: Object.fromEntries(
      Object.entries(columns.generation_approvals).filter(
        ([name]) => name !== "billing_pricing",
      ),
    ),
  };
  const f = fixture(legacy);
  const report = await inspectLegacyDowngrade({ client: f.client });
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.tables.background_jobs.absentColumns, [
    "billing_required",
    "billing_receipt",
    "billing_pricing",
    "settlement_review",
    "billing_approval_id",
    "cancel_requested_at",
  ]);
  assert.deepEqual(report.tables.generation_approvals.absentColumns, [
    "billing_pricing",
  ]);
  assert.equal(
    report.checks.generation_billing_required.state,
    "column_absent",
  );
  assert.equal(report.checks.approval_billing_pricing.state, "column_absent");
  for (const { sql } of f.queries.filter(({ sql }) =>
    sql.includes("downgrade:"),
  ))
    assert.doesNotMatch(
      sql,
      /"billing_required"|"billing_receipt"|"billing_pricing"|"settlement_review"|"billing_approval_id"|"cancel_requested_at"/,
    );
});

test("reports absent project contexts while refusing missing core tables", async () => {
  const missing = Object.fromEntries(
    Object.entries(columns).filter(
      ([name]) =>
        name !== "project_user_contexts" && name !== "background_jobs",
    ),
  );
  const report = await inspectLegacyDowngrade({
    client: fixture(missing).client,
  });
  assert.equal(report.tables.project_user_contexts.state, "absent");
  assert.equal(report.tables.background_jobs.state, "absent");
  assert.deepEqual(report.coverage.absent, [
    "background_jobs",
    "project_user_contexts",
  ]);
  assert.deepEqual(report.blockers, [
    { table: "background_jobs", code: "required_table_absent", count: 1 },
  ]);
  assert.equal(report.checks.project_fitting_views.state, "table_absent");
});

test("refuses missing required fields, incompatible types, views, and hidden RLS rows", async () => {
  for (const change of ["missing", "type", "view", "rls"]) {
    const f = fixture();
    const first = f.catalog.find(
      ({ table_name }) => table_name === "background_jobs",
    );
    if (change === "missing") f.catalog.splice(f.catalog.indexOf(first), 1);
    if (change === "type") first.data_type = "integer";
    for (const row of f.catalog.filter(
      ({ table_name }) => table_name === "background_jobs",
    )) {
      if (change === "view") row.relation_kind = "v";
      if (change === "rls") row.row_security_active = true;
    }
    const report = await inspectLegacyDowngrade({ client: f.client });
    assert.equal(report.tables.background_jobs.state, "unsupported");
    assert(report.blockers.some(({ code }) => code === "unsupported_schema"));
    assert(
      !f.queries.some(({ sql }) =>
        sql.includes('from "public"."background_jobs"'),
      ),
    );
  }
});

test("rejects malformed or conflicting metadata before trusting aggregate counts", async () => {
  for (const change of [
    "unknown-table",
    "duplicate",
    "inconsistent-kind",
    "invalid-rls",
    "invalid-name",
  ]) {
    const f = fixture();
    if (change === "unknown-table")
      f.catalog.push({ ...f.catalog[0], table_name: "private-secret-name" });
    if (change === "duplicate") f.catalog.push({ ...f.catalog[0] });
    if (change === "inconsistent-kind") f.catalog[1].relation_kind = "v";
    if (change === "invalid-rls") f.catalog[0].row_security_active = undefined;
    if (change === "invalid-name")
      f.catalog[0].column_name = "private-secret-name";
    await assert.rejects(
      inspectLegacyDowngrade({ client: f.client }),
      /metadata/i,
    );
    assert.equal(f.queries.at(-1).sql, "rollback");
  }
});

test("rejects malformed aggregate rows and unsafe numeric ranges", async () => {
  for (const count of [undefined, null, "-1", "NaN", "9007199254740992", 0.5]) {
    const f = fixture();
    const query = f.client.query;
    f.client.query = (sql, values) =>
      sql.includes("downgrade:generation_billing_required")
        ? Promise.resolve({ rows: [{ count }] })
        : query(sql, values);
    await assert.rejects(
      inspectLegacyDowngrade({ client: f.client }),
      /count/i,
    );
    assert.equal(f.queries.at(-1).sql, "rollback");
  }
});

test("requires the database to confirm read-only state before metadata probes", async () => {
  const f = fixture();
  f.snapshot.read_only = "off";
  await assert.rejects(
    inspectLegacyDowngrade({ client: f.client }),
    /read.only/i,
  );
  assert(!f.queries.some(({ sql }) => sql.includes("pg_catalog.pg_class")));
});

test("releases only borrowed pool clients and preserves query plus rollback errors", async () => {
  const f = fixture();
  let releases = 0;
  f.client.release = () => {
    releases += 1;
  };
  await inspectLegacyDowngrade({ pool: { connect: async () => f.client } });
  await inspectLegacyDowngrade({ client: f.client });
  assert.equal(releases, 1);
  const refused = new Error("private query details");
  const cleanup = new Error("private rollback details");
  const query = f.client.query;
  f.client.query = async (sql, values) => {
    if (sql.includes("pg_catalog.pg_class")) throw refused;
    if (sql === "rollback") throw cleanup;
    return query(sql, values);
  };
  await assert.rejects(
    inspectLegacyDowngrade({ pool: { connect: async () => f.client } }),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === refused &&
      error.errors[1] === cleanup,
  );
  assert.equal(releases, 2);
});

test("rejects falsey thrown errors and missing or ambiguous connection injection", async () => {
  await assert.rejects(inspectLegacyDowngrade(), /client or pool/i);
  await assert.rejects(
    inspectLegacyDowngrade({ client: {}, pool: {} }),
    /client or pool/i,
  );
  const f = fixture();
  f.client.query = async () => {
    throw null;
  };
  await assert.rejects(
    inspectLegacyDowngrade({ client: f.client }),
    /downgrade/i,
  );
});

test("accepts only explicit loopback database URLs without hidden transport overrides", () => {
  for (const url of [
    "postgres://operator@127.0.0.1/app",
    "postgresql://operator@[::1]:5432/app",
    "postgres://operator@localhost/app",
  ])
    assert.equal(validateLoopbackDatabaseUrl(url), url);
  for (const url of [
    undefined,
    "",
    "postgres://operator@203.0.113.1/app",
    "postgres:///app",
    "postgres://operator@127.0.0.1/app?host=remote",
    "postgres://operator@127.0.0.1/app#fragment",
  ])
    assert.throws(
      () => validateLoopbackDatabaseUrl(url),
      /DATABASE_URL|loopback|override/i,
    );
});

test("CLI rejects missing or remote database URLs without printing credentials", () => {
  const script = fileURLToPath(
    new URL("./legacy-downgrade-guard.mjs", import.meta.url),
  );
  const env = { ...process.env, DATABASE_URL: undefined };
  const missing = spawnSync(process.execPath, [script], {
    env,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /DATABASE_URL/);
  const denied = spawnSync(process.execPath, [script], {
    env: {
      ...env,
      DATABASE_URL: "postgres://operator:do-not-print@203.0.113.1/app",
    },
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  assert.equal(denied.status, 1);
  assert(!`${denied.stdout}${denied.stderr}`.includes("do-not-print"));
  assert(!`${denied.stdout}${denied.stderr}`.includes("203.0.113.1"));
});
