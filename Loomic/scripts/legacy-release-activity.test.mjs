import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  inspectLegacyReleaseActivity,
  validateLoopbackDatabaseUrl,
} from "./legacy-release-activity.mjs";

const core = {
  background_jobs: ["status", "sync_claimed_at"],
  agent_runs: ["status", "run_owner", "run_lease_until"],
};
const allTables = {
  ...core,
  agent_goals: ["status"],
  agent_goal_steps: ["state", "lease_token", "lease_until"],
  video_transcripts: ["state", "lease_token", "lease_until"],
  video_transcript_exports: ["state", "lease_token", "lease_until"],
  desktop_agent_tasks: ["status"],
  media_resource_leases: ["lease_until"],
};

function fixture(tables = core, groups = {}) {
  const queries = [];
  const snapshot = { observed_at: "2026-11-16T12:00:00.000Z", read_only: "on" };
  const catalog = Object.entries(tables).flatMap(([table, columns]) =>
    columns.map((name) => ({
      table_name: table,
      relation_kind: "r",
      column_name: name,
      data_type:
        name.endsWith("_at") || name.endsWith("_until")
          ? "timestamp with time zone"
          : name.endsWith("_token") || name === "run_owner"
            ? "uuid"
            : "text",
    })),
  );
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("pg_catalog.pg_class")) return { rows: catalog };
      if (sql.startsWith("select transaction_timestamp"))
        return { rows: [snapshot] };
      const table = /from "public"\."([a-z_]+)"/i.exec(sql)?.[1];
      return { rows: table ? (groups[table] ?? []) : [] };
    },
  };
  return { client, queries, catalog, snapshot };
}

test("reports queued durable work separately and optional tables as absent", async () => {
  const f = fixture(core, {
    background_jobs: [{ state: "queued", count: "3", sync_claims: "0" }],
    agent_runs: [
      {
        state: "completed",
        count: "4",
        active_owned: "0",
        active_ownerless: "0",
        live_run_leases: "0",
      },
    ],
  });
  const report = await inspectLegacyReleaseActivity({ client: f.client });
  assert.equal(report.schema, "public");
  assert.equal(report.activity, "none_observed");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.tables.agent_goals.state, "absent");
  assert(report.coverage.absent.includes("agent_goals"));
  assert.equal(report.tables.background_jobs.statuses.queued, 3);
  assert.equal(report.durableWork.background_jobs.queued, 3);
  assert.deepEqual(report.tables.background_jobs.columns, [
    { name: "status", type: "text" },
    { name: "sync_claimed_at", type: "timestamp with time zone" },
  ]);
  assert.equal(report.ok, undefined);
  assert(f.queries[0].sql.includes("read only"));
  assert.equal(f.queries.at(-1).sql, "commit");
  const metadata = f.queries.find(({ sql }) =>
    sql.includes("pg_catalog.pg_class"),
  );
  assert.equal(metadata.values[0], "public");
  assert.equal(metadata.values[1].length, 8);
  for (const { sql } of f.queries) {
    assert.match(sql, /^(?:begin|set local|select|commit)\b/i);
    assert.doesNotMatch(
      sql,
      /\b(?:insert|update|delete|truncate|alter|create|drop)\b/i,
    );
    assert.doesNotMatch(sql, /select\s+\*/i);
  }
});

test("blocks running jobs and any retained sync claim without reading payloads", async () => {
  const f = fixture(core, {
    background_jobs: [
      { state: "queued", count: "2", sync_claims: "1" },
      { state: "running", count: "1", sync_claims: "0" },
    ],
  });
  const report = await inspectLegacyReleaseActivity({ client: f.client });
  assert.equal(report.activity, "blocked");
  assert.deepEqual(
    report.blockers.map(({ code, count }) => [code, count]),
    [
      ["background_jobs_running", 1],
      ["background_jobs_sync_claims", 1],
    ],
  );
  for (const { sql } of f.queries.filter(({ sql }) =>
    sql.includes('from "public".'),
  ))
    assert.doesNotMatch(
      sql,
      /payload|result|source_path|goal\b|error_message/i,
    );
});

test("blocks both owned and ownerless agent runs and keeps legacy ownership gaps explicit", async () => {
  const owned = fixture(core, {
    agent_runs: [
      {
        state: "running",
        count: "3",
        active_owned: "2",
        active_ownerless: "1",
        live_run_leases: "1",
      },
    ],
  });
  const report = await inspectLegacyReleaseActivity({ client: owned.client });
  assert.deepEqual(
    report.blockers.map(({ code, count }) => [code, count]),
    [
      ["agent_runs_owned_active", 2],
      ["agent_runs_ownerless_active", 1],
    ],
  );
  const legacy = fixture(
    { ...core, agent_runs: ["status"] },
    {
      agent_runs: [{ state: "accepted", count: "2", active_ownerless: "2" }],
    },
  );
  const old = await inspectLegacyReleaseActivity({ client: legacy.client });
  assert.equal(old.tables.agent_runs.metrics.active_ownerless, 2);
  assert(old.tables.agent_runs.unavailableChecks.includes("run_owner"));
  assert(old.tables.agent_runs.unavailableChecks.includes("run_lease_until"));
  assert(
    old.blockers.some(({ code }) => code === "agent_runs_ownerless_active"),
  );
  const query = legacy.queries.find(({ sql }) =>
    sql.includes('from "public"."agent_runs"'),
  );
  assert.doesNotMatch(query.sql, /"run_owner"|"run_lease_until"/);
});

test("blocks executing steps, OneTake, exports, desktop tasks, and live media leases", async () => {
  const f = fixture(allTables, {
    agent_goal_steps: [
      { state: "running", count: "1", leases: "1", live_leases: "1" },
    ],
    video_transcripts: [
      { state: "running", count: "2", leases: "2", live_leases: "2" },
    ],
    video_transcript_exports: [
      { state: "queued", count: "1", leases: "1", live_leases: "1" },
    ],
    desktop_agent_tasks: [{ state: "running", count: "1" }],
    media_resource_leases: [
      { state: "lease", count: "3", live_leases: "2", expired_leases: "1" },
    ],
  });
  const report = await inspectLegacyReleaseActivity({ client: f.client });
  const counts = Object.fromEntries(
    report.blockers.map(({ code, count }) => [code, count]),
  );
  assert.equal(counts.agent_goal_steps_running, 1);
  assert.equal(counts.agent_goal_steps_leases, 1);
  assert.equal(counts.video_transcripts_running, 2);
  assert.equal(counts.video_transcripts_live_leases, 2);
  assert.equal(counts.video_transcript_exports_live_leases, 1);
  assert.equal(counts.desktop_agent_tasks_running, 1);
  assert.equal(counts.media_resource_leases_live, 2);
});

test("does not turn queued work, waiting workflows, or expired media leases into execution", async () => {
  const f = fixture(allTables, {
    agent_goals: [
      { state: "running", count: "2" },
      { state: "waiting_desktop", count: "1" },
    ],
    agent_goal_steps: [
      { state: "queued", count: "2", leases: "0", live_leases: "0" },
    ],
    video_transcripts: [
      { state: "queued", count: "3", leases: "0", live_leases: "0" },
    ],
    video_transcript_exports: [
      { state: "pending", count: "4", leases: "0", live_leases: "0" },
    ],
    desktop_agent_tasks: [
      { state: "queued", count: "5" },
      { state: "waiting_approval", count: "1" },
    ],
    media_resource_leases: [
      { state: "lease", count: "2", live_leases: "0", expired_leases: "2" },
    ],
  });
  const report = await inspectLegacyReleaseActivity({ client: f.client });
  assert.deepEqual(report.blockers, []);
  assert.equal(report.durableWork.agent_goal_steps.queued, 2);
  assert.equal(report.durableWork.video_transcripts.queued, 3);
  assert.equal(report.durableWork.video_transcript_exports.pending, 4);
  assert.equal(report.durableWork.desktop_agent_tasks.queued, 5);
  assert.equal(report.tables.agent_goals.statuses.running, 2);
  assert.equal(report.tables.media_resource_leases.metrics.expired_leases, 2);
});

test("refuses missing core tables, missing required columns, and views", async () => {
  const f = fixture({ background_jobs: ["payload"], agent_goals: ["status"] });
  f.catalog.find(
    ({ table_name }) => table_name === "agent_goals",
  ).relation_kind = "v";
  const report = await inspectLegacyReleaseActivity({ client: f.client });
  assert.equal(report.tables.agent_runs.state, "absent");
  assert.equal(report.tables.background_jobs.state, "unsupported");
  assert.equal(report.tables.agent_goals.state, "unsupported");
  assert(report.blockers.some(({ code }) => code === "required_table_absent"));
  assert(report.blockers.some(({ code }) => code === "unsupported_schema"));
  assert(!f.queries.some(({ sql }) => sql.includes('from "public".')));
});

test("counts unfamiliar statuses conservatively without copying their text into output", async () => {
  const f = fixture(core, {
    background_jobs: [
      { state: "untrusted-private-text", count: "1", sync_claims: "0" },
    ],
  });
  const report = await inspectLegacyReleaseActivity({ client: f.client });
  assert(report.blockers.some(({ code }) => code === "unrecognized_status"));
  assert.equal(report.tables.background_jobs.unknownStatuses, 1);
  assert(!JSON.stringify(report).includes("untrusted-private-text"));
});

test("releases an acquired pool client after success without closing the caller's pool", async () => {
  const f = fixture();
  let releases = 0;
  f.client.release = () => {
    releases += 1;
  };
  await inspectLegacyReleaseActivity({
    pool: { connect: async () => f.client },
  });
  assert.equal(releases, 1);
  await inspectLegacyReleaseActivity({ client: f.client });
  assert.equal(releases, 1);
});

test("rolls back query errors, preserves cleanup failures, and releases the client", async () => {
  const f = fixture();
  const queryError = new Error("query failed");
  const rollbackError = new Error("rollback failed");
  const query = f.client.query;
  let releases = 0;
  f.client.release = () => {
    releases += 1;
  };
  f.client.query = async (sql, values) => {
    if (sql.includes("pg_catalog.pg_class")) throw queryError;
    if (sql === "rollback") throw rollbackError;
    return query(sql, values);
  };
  await assert.rejects(
    inspectLegacyReleaseActivity({ pool: { connect: async () => f.client } }),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === queryError &&
      error.errors[1] === rollbackError,
  );
  assert.equal(releases, 1);
  assert(!f.queries.some(({ sql }) => sql === "commit"));
});

test("rejects malformed aggregate counts instead of declaring no activity", async () => {
  const f = fixture(core, {
    background_jobs: [
      { state: "queued", count: "9007199254740992", sync_claims: "0" },
    ],
  });
  await assert.rejects(
    inspectLegacyReleaseActivity({ client: f.client }),
    /count/i,
  );
  assert.equal(f.queries.at(-1).sql, "rollback");
});

test("does not silently accept a falsy query rejection", async () => {
  const f = fixture();
  const query = f.client.query;
  f.client.query = async (sql, values) => {
    if (sql.includes("pg_catalog.pg_class")) throw null;
    return query(sql, values);
  };
  await assert.rejects(
    inspectLegacyReleaseActivity({ client: f.client }),
    /inspection/i,
  );
  assert.equal(f.queries.at(-1).sql, "rollback");
});

test("requires PostgreSQL to confirm the snapshot is read only", async () => {
  const f = fixture();
  f.snapshot.read_only = "off";
  await assert.rejects(
    inspectLegacyReleaseActivity({ client: f.client }),
    /read.only/i,
  );
  assert.equal(f.queries.at(-1).sql, "rollback");
  assert(!f.queries.some(({ sql }) => sql.includes("pg_catalog.pg_class")));
});

test("requires exactly one injectable connection source", async () => {
  await assert.rejects(inspectLegacyReleaseActivity({}), /client or pool/i);
  const f = fixture();
  await assert.rejects(
    inspectLegacyReleaseActivity({ client: f.client, pool: {} }),
    /client or pool/i,
  );
});

test("accepts only explicit loopback PostgreSQL URLs without transport overrides", () => {
  for (const url of [
    "postgres://operator@127.0.0.1/helstera",
    "postgresql://operator@[::1]:5432/helstera",
    "postgres://operator@localhost/helstera",
  ])
    assert.equal(validateLoopbackDatabaseUrl(url), url);
  for (const url of [
    undefined,
    "",
    "postgres://operator@203.0.113.1/helstera",
    "postgres:///helstera",
    "https://127.0.0.1/helstera",
    "postgres://operator@127.0.0.1/helstera?host=remote",
    "postgres://operator@127.0.0.1/helstera#fragment",
  ])
    assert.throws(
      () => validateLoopbackDatabaseUrl(url),
      /DATABASE_URL|loopback|override/i,
    );
});

test("CLI does not load a hidden env file or print a rejected URL", () => {
  const env = { ...process.env, DATABASE_URL: undefined };
  const script = fileURLToPath(
    new URL("./legacy-release-activity.mjs", import.meta.url),
  );
  const missing = spawnSync(process.execPath, [script], {
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /DATABASE_URL/);
  const denied = spawnSync(process.execPath, [script], {
    env: {
      ...env,
      DATABASE_URL: "postgres://operator:do-not-print@203.0.113.1/helstera",
    },
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  assert.equal(denied.status, 1);
  assert(!`${denied.stdout}${denied.stderr}`.includes("do-not-print"));
  assert(!`${denied.stdout}${denied.stderr}`.includes("203.0.113.1"));
});
