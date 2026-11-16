import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TABLES = [
  {
    name: "background_jobs",
    required: true,
    columns: { job_type: "text" },
    optional: {
      billing_required: "boolean",
      billing_receipt: "jsonb",
      billing_pricing: "jsonb",
      settlement_review: "jsonb",
      billing_approval_id: "uuid",
      cancel_requested_at: "timestamp with time zone",
    },
  },
  {
    name: "credit_transactions",
    required: true,
    columns: { transaction_type: "text" },
    optional: {},
  },
  {
    name: "generation_approvals",
    required: true,
    columns: {
      workspace_id: "uuid",
      user_id: "uuid",
      job_type: "text",
      model: "text",
      payload_fingerprint: "text",
      status: "text",
      context: "jsonb",
    },
    optional: { billing_pricing: "jsonb" },
  },
  {
    name: "project_user_contexts",
    required: false,
    columns: { view: "text" },
    optional: {},
  },
];

const CATALOG_SQL = `select c.relname as table_name,c.relkind as relation_kind,
  a.attname as column_name,pg_catalog.format_type(a.atttypid,a.atttypmod) as data_type,
  pg_catalog.row_security_active(c.oid) as row_security_active
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where n.nspname=$1 and c.relname=any($2::text[])
  order by c.relname,a.attnum`;

function guardError(error) {
  return error instanceof Error
    ? error
    : new Error("Downgrade inspection rejected without an Error", {
        cause: error,
      });
}

function readCount(rows) {
  if (!Array.isArray(rows) || rows.length !== 1)
    throw new Error(
      "Downgrade check did not return exactly one aggregate count",
    );
  const value = rows[0]?.count;
  if (
    !(
      typeof value === "number" ||
      (typeof value === "string" && /^\d+$/.test(value))
    )
  )
    throw new Error("Downgrade aggregate count is invalid");
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 0)
    throw new Error("Downgrade aggregate count exceeds the supported range");
  return quantity;
}

function checkSpecs(spec) {
  switch (spec.name) {
    case "background_jobs":
      return Object.keys(spec.optional).map((field) => ({
        code: `generation_${field}`,
        field,
        where: `"job_type" in ('image_generation','video_generation') and "${field}" ${field === "billing_required" ? "is true" : "is not null"}`,
      }));
    case "credit_transactions":
      return [
        {
          code: "generation_adjustments",
          where: "\"transaction_type\"='generation_adjustment'",
        },
      ];
    case "generation_approvals":
      return [
        {
          code: "approval_billing_pricing",
          field: "billing_pricing",
          where: '"billing_pricing" is not null',
        },
        {
          code: "approval_pending_old_key_duplicates",
          query: `select count(*)::text as count from (
            select 1 from "public"."generation_approvals" where "status"='pending'
            group by "workspace_id","user_id","job_type","model","payload_fingerprint",
              coalesce("context"->>'canvasId',''),coalesce("context"->>'sessionId','')
            having count(*)>1) as conflicting_groups`,
        },
        {
          code: "approval_extra_context",
          // Old approval lookup uses only these two context keys, even for confirmed rows.
          where: `"context" is null or jsonb_typeof("context")<>'object'
            or ("context" - 'canvasId' - 'sessionId')<>'{}'::jsonb`,
        },
      ];
    case "project_user_contexts":
      return [{ code: "project_fitting_views", where: "\"view\"='fitting'" }];
    default:
      throw new Error("Downgrade table lacks a check definition");
  }
}

function validateCatalog(rows) {
  if (!Array.isArray(rows))
    throw new Error("Downgrade metadata must be a row array");
  const seen = new Set();
  const kinds = new Map();
  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object" ||
      !TABLES.some(({ name }) => name === row.table_name) ||
      typeof row.column_name !== "string" ||
      !/^[a-z_][a-z0-9_]*$/.test(row.column_name) ||
      typeof row.data_type !== "string" ||
      !/^[a-z][a-z0-9 (),\[\]]*$/.test(row.data_type) ||
      typeof row.row_security_active !== "boolean" ||
      typeof row.relation_kind !== "string" ||
      !/^[a-z]$/.test(row.relation_kind)
    )
      throw new Error(
        "Downgrade metadata contains an invalid relation or column description",
      );
    const key = `${row.table_name}.${row.column_name}`;
    const kind = `${row.relation_kind}:${row.row_security_active}`;
    if (
      seen.has(key) ||
      (kinds.has(row.table_name) && kinds.get(row.table_name) !== kind)
    )
      throw new Error(
        "Downgrade metadata contains duplicate or conflicting relation descriptions",
      );
    seen.add(key);
    kinds.set(row.table_name, kind);
  }
}

async function inspectSnapshot(client) {
  const { rows: time } = await client.query(
    "select transaction_timestamp() as observed_at,current_setting('transaction_read_only') as read_only",
  );
  if (time?.[0]?.read_only !== "on")
    throw new Error("Downgrade snapshot is not read only");
  const observedAt = new Date(time[0].observed_at);
  if (!Number.isFinite(observedAt.getTime()))
    throw new Error("Downgrade snapshot timestamp is invalid");
  const { rows: catalog } = await client.query(CATALOG_SQL, [
    "public",
    TABLES.map(({ name }) => name),
  ]);
  validateCatalog(catalog);
  const report = {
    schema: "public",
    observedAt: observedAt.toISOString(),
    readOnly: true,
    downgrade: "no_blockers_observed",
    tables: {},
    checks: {},
    blockers: [],
    coverage: { checked: [], absent: [], unsupported: [], partial: [] },
  };
  for (const spec of TABLES) {
    const metadata = catalog.filter(
      ({ table_name }) => table_name === spec.name,
    );
    const checks = checkSpecs(spec);
    if (!metadata.length) {
      report.tables[spec.name] = {
        state: "absent",
        columns: [],
        absentColumns: [],
      };
      report.coverage.absent.push(spec.name);
      for (const { code } of checks)
        report.checks[code] = { state: "table_absent" };
      if (spec.required)
        report.blockers.push({
          table: spec.name,
          code: "required_table_absent",
          count: 1,
        });
      continue;
    }
    const fields = new Map(
      metadata.map(({ column_name, data_type }) => [column_name, data_type]),
    );
    const expected = { ...spec.columns, ...spec.optional };
    const knownColumns = Object.keys(expected)
      .filter((name) => fields.has(name))
      .map((name) => ({ name, type: fields.get(name) }));
    const absentColumns = Object.keys(spec.optional).filter(
      (name) => !fields.has(name),
    );
    const missingColumns = Object.keys(spec.columns).filter(
      (name) => !fields.has(name),
    );
    const incompatibleColumns = Object.keys(expected).filter(
      (name) => fields.has(name) && fields.get(name) !== expected[name],
    );
    const { relation_kind: kind, row_security_active: rowSecurity } =
      metadata[0];
    if (
      !["r", "p"].includes(kind) ||
      rowSecurity ||
      missingColumns.length ||
      incompatibleColumns.length
    ) {
      report.tables[spec.name] = {
        state: "unsupported",
        columns: knownColumns,
        absentColumns,
        missingColumns,
        incompatibleColumns,
        rowSecurity,
      };
      report.coverage.unsupported.push(spec.name);
      report.blockers.push({
        table: spec.name,
        code: "unsupported_schema",
        count: 1,
      });
      for (const { code } of checks)
        report.checks[code] = { state: "unsupported_schema" };
      continue;
    }
    report.tables[spec.name] = {
      state: "checked",
      columns: knownColumns,
      absentColumns,
    };
    report.coverage.checked.push(spec.name);
    if (absentColumns.length) report.coverage.partial.push(spec.name);
    for (const check of checks) {
      if (check.field && !fields.has(check.field)) {
        report.checks[check.code] = { state: "column_absent" };
        continue;
      }
      const sql = `/* downgrade:${check.code} */ ${check.query ?? `select count(*)::text as count from "public"."${spec.name}" where ${check.where}`}`;
      const { rows } = await client.query(sql);
      const count = readCount(rows);
      report.checks[check.code] = { state: "checked", count };
      if (count)
        report.blockers.push({ table: spec.name, code: check.code, count });
    }
  }
  if (report.blockers.length) report.downgrade = "blocked";
  return report;
}

/** Count incompatible legacy state in one snapshot; this does not prove process drain. */
export async function inspectLegacyDowngrade({ pool, client } = {}) {
  if (Boolean(pool) === Boolean(client))
    throw new TypeError("Provide exactly one client or pool");
  const connection = pool ? await pool.connect() : client;
  let report;
  let failure;
  let began = false;
  try {
    await connection.query(
      "begin transaction isolation level repeatable read, read only",
    );
    began = true;
    await connection.query("set local statement_timeout='5s'");
    await connection.query("set local lock_timeout='2s'");
    report = await inspectSnapshot(connection);
    await connection.query("commit");
    began = false;
  } catch (error) {
    failure = guardError(error);
    if (began) {
      try {
        await connection.query("rollback");
      } catch (rollbackError) {
        failure = new AggregateError(
          [failure, guardError(rollbackError)],
          "Downgrade inspection and rollback failed",
        );
      }
    }
  } finally {
    if (pool) {
      try {
        connection.release(failure);
      } catch (releaseError) {
        failure = failure
          ? new AggregateError(
              [failure, guardError(releaseError)],
              "Downgrade inspection could not release its connection",
            )
          : guardError(releaseError);
      }
    }
  }
  if (failure) throw failure;
  return report;
}

class DatabaseUrlError extends Error {}

export function validateLoopbackDatabaseUrl(value) {
  if (typeof value !== "string" || !value.trim())
    throw new DatabaseUrlError(
      "DATABASE_URL must be explicit; no env file is loaded.",
    );
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new DatabaseUrlError(
      "DATABASE_URL must be an explicit loopback PostgreSQL URL.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.pathname ||
    url.pathname === "/"
  )
    throw new DatabaseUrlError(
      "DATABASE_URL must target an explicit loopback PostgreSQL database.",
    );
  if (url.search || url.hash)
    throw new DatabaseUrlError(
      "DATABASE_URL transport overrides and fragments are not accepted.",
    );
  return value;
}

async function main() {
  if (process.argv.length > 2)
    throw new DatabaseUrlError(
      "Set DATABASE_URL explicitly; the CLI accepts no arguments.",
    );
  const databaseUrl = validateLoopbackDatabaseUrl(process.env.DATABASE_URL);
  const requireServer = createRequire(
    new URL("../apps/server/package.json", import.meta.url),
  );
  const { Pool } = requireServer("pg");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
    application_name: "helstera-legacy-downgrade-guard",
  });
  let report;
  let failure;
  pool.on("error", (error) => {
    failure = failure
      ? new AggregateError(
          [failure, guardError(error)],
          "Downgrade pool connection failed",
        )
      : guardError(error);
  });
  try {
    report = await inspectLegacyDowngrade({ pool });
  } catch (error) {
    failure = failure
      ? new AggregateError(
          [failure, guardError(error)],
          "Downgrade inspection failed",
        )
      : guardError(error);
  } finally {
    try {
      await pool.end();
    } catch (error) {
      failure = failure
        ? new AggregateError(
            [failure, guardError(error)],
            "Downgrade connection shutdown failed",
          )
        : guardError(error);
    }
  }
  if (failure) throw failure;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.blockers.length ? 2 : 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error) => {
    const sqlState =
      typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)
        ? error.code
        : undefined;
    process.stderr.write(
      `${JSON.stringify({
        error: {
          code: "downgrade_inspection_failed",
          message:
            error instanceof DatabaseUrlError
              ? error.message
              : "Legacy downgrade inspection failed.",
          ...(sqlState ? { sqlState } : {}),
        },
      })}\n`,
    );
    process.exitCode = 1;
  });
}
