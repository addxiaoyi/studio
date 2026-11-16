import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TABLES = [
  {
    name: "background_jobs",
    required: true,
    field: "status",
    states: [
      "queued",
      "running",
      "succeeded",
      "failed",
      "sync_pending",
      "sync_failed",
      "canceled",
      "dead_letter",
    ],
    durable: ["queued", "sync_pending", "sync_failed"],
    optional: ["sync_claimed_at"],
  },
  {
    name: "agent_runs",
    required: true,
    field: "status",
    states: ["accepted", "running", "completed", "failed"],
    durable: [],
    optional: ["run_owner", "run_lease_until"],
  },
  {
    name: "agent_goals",
    field: "status",
    states: [
      "draft",
      "running",
      "waiting_approval",
      "waiting_desktop",
      "paused",
      "completed",
      "failed",
      "canceled",
    ],
    durable: [
      "draft",
      "running",
      "waiting_approval",
      "waiting_desktop",
      "paused",
    ],
    optional: [],
  },
  {
    name: "agent_goal_steps",
    field: "state",
    states: [
      "queued",
      "running",
      "waiting_approval",
      "waiting_desktop",
      "review",
      "succeeded",
      "failed",
      "canceled",
    ],
    durable: ["queued", "waiting_approval", "waiting_desktop", "review"],
    optional: ["lease_token", "lease_until"],
  },
  {
    name: "video_transcripts",
    field: "state",
    states: ["queued", "running", "completed", "failed", "canceled", "expired"],
    durable: ["queued"],
    optional: ["lease_token", "lease_until"],
  },
  {
    name: "video_transcript_exports",
    field: "state",
    states: ["pending", "queued", "running", "completed", "failed", "canceled"],
    durable: ["pending", "queued"],
    optional: ["lease_token", "lease_until"],
  },
  {
    name: "desktop_agent_tasks",
    field: "status",
    states: [
      "queued",
      "running",
      "waiting_approval",
      "waiting_desktop",
      "paused",
      "succeeded",
      "failed",
      "canceled",
    ],
    durable: ["queued", "waiting_approval", "waiting_desktop", "paused"],
    optional: [],
  },
  {
    name: "media_resource_leases",
    field: null,
    states: ["lease"],
    durable: [],
    optional: [],
  },
];

const CATALOG_SQL = `select c.relname as table_name, c.relkind as relation_kind,
  a.attname as column_name, pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where n.nspname=$1 and c.relname=any($2::text[])
  order by c.relname,a.attnum`;

function count(value) {
  if (
    !(
      typeof value === "number" ||
      (typeof value === "string" && /^\d+$/.test(value))
    )
  )
    throw new Error("Activity aggregate contains an invalid count");
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 0)
    throw new Error("Activity aggregate count exceeds the supported range");
  return quantity;
}

function add(left, right) {
  return count(left + right);
}

function inspectionError(error) {
  return error instanceof Error
    ? error
    : new Error("Activity inspection rejected without an Error", {
        cause: error,
      });
}

function columnType(name) {
  if (name.endsWith("_at") || name.endsWith("_until"))
    return "timestamp with time zone";
  if (name.endsWith("_token") || name === "run_owner") return "uuid";
  return "text";
}

function aggregateQuery(spec, fields) {
  const metrics = {};
  const activeRun = "\"status\" in ('accepted','running')";
  if (spec.name === "background_jobs" && fields.has("sync_claimed_at"))
    metrics.sync_claims = '"sync_claimed_at" is not null';
  if (spec.name === "agent_runs") {
    metrics.active_ownerless = fields.has("run_owner")
      ? `${activeRun} and "run_owner" is null`
      : activeRun;
    if (fields.has("run_owner"))
      metrics.active_owned = `${activeRun} and "run_owner" is not null`;
    if (fields.has("run_lease_until"))
      metrics.live_run_leases = `${activeRun} and "run_lease_until">transaction_timestamp()`;
  }
  if (spec.optional.includes("lease_token")) {
    const claims = ["lease_token", "lease_until"].filter((field) =>
      fields.has(field),
    );
    if (claims.length)
      metrics.leases = claims
        .map((field) => `"${field}" is not null`)
        .join(" or ");
    if (fields.has("lease_until"))
      metrics.live_leases = '"lease_until">transaction_timestamp()';
  }
  if (spec.name === "media_resource_leases") {
    metrics.live_leases = '"lease_until">transaction_timestamp()';
    metrics.expired_leases = '"lease_until"<=transaction_timestamp()';
  }
  const state = spec.field ? `"${spec.field}"::text` : "'lease'::text";
  const terms = [
    `${state} as state`,
    "count(*)::text as count",
    ...Object.entries(metrics).map(
      ([name, predicate]) =>
        `count(*) filter (where ${predicate})::text as "${name}"`,
    ),
  ];
  return {
    sql: `select ${terms.join(", ")} from "public"."${spec.name}"${spec.field ? ` group by "${spec.field}" order by "${spec.field}"` : ""}`,
    metrics: Object.keys(metrics),
  };
}

function summarize(spec, rows, metricNames) {
  const statuses = Object.fromEntries(spec.states.map((state) => [state, 0]));
  const metrics = Object.fromEntries(metricNames.map((name) => [name, 0]));
  let total = 0;
  let unknownStatuses = 0;
  for (const row of rows) {
    const quantity = count(row.count);
    total = add(total, quantity);
    if (spec.states.includes(row.state))
      statuses[row.state] = add(statuses[row.state], quantity);
    else unknownStatuses = add(unknownStatuses, quantity);
    for (const name of metricNames) {
      const measured = count(row[name]);
      if (measured > quantity)
        throw new Error("Activity metric exceeds its aggregate count");
      metrics[name] = add(metrics[name], measured);
    }
  }
  return { total, statuses, metrics, unknownStatuses };
}

function activityBlockers(spec, summary) {
  const blockers = [];
  const block = (code, quantity) => {
    if (quantity) blockers.push({ table: spec.name, code, count: quantity });
  };
  const { statuses, metrics } = summary;
  block("unrecognized_status", summary.unknownStatuses);
  switch (spec.name) {
    case "background_jobs":
      block("background_jobs_running", statuses.running);
      block("background_jobs_sync_claims", metrics.sync_claims);
      break;
    case "agent_runs":
      block("agent_runs_owned_active", metrics.active_owned);
      block("agent_runs_ownerless_active", metrics.active_ownerless);
      break;
    case "agent_goal_steps":
      block("agent_goal_steps_running", statuses.running);
      block("agent_goal_steps_leases", metrics.leases);
      break;
    case "video_transcripts":
    case "video_transcript_exports":
      block(`${spec.name}_running`, statuses.running);
      block(`${spec.name}_live_leases`, metrics.live_leases);
      break;
    case "desktop_agent_tasks":
      block("desktop_agent_tasks_running", statuses.running);
      break;
    case "media_resource_leases":
      block("media_resource_leases_live", metrics.live_leases);
      break;
  }
  return blockers;
}

async function inspectSnapshot(client) {
  const { rows: time } = await client.query(
    "select transaction_timestamp() as observed_at, current_setting('transaction_read_only') as read_only",
  );
  if (time[0]?.read_only !== "on")
    throw new Error("Activity snapshot is not read only");
  const observedAt = new Date(time[0]?.observed_at);
  if (!Number.isFinite(observedAt.getTime()))
    throw new Error("Database snapshot timestamp is missing");
  const { rows: catalog } = await client.query(CATALOG_SQL, [
    "public",
    TABLES.map(({ name }) => name),
  ]);
  const report = {
    schema: "public",
    observedAt: observedAt.toISOString(),
    readOnly: true,
    activity: "none_observed",
    tables: {},
    blockers: [],
    durableWork: {},
    coverage: { checked: [], absent: [], unsupported: [], partial: [] },
  };
  for (const spec of TABLES) {
    const metadata = catalog.filter(
      ({ table_name }) => table_name === spec.name,
    );
    const columns = metadata.map(({ column_name, data_type }) => ({
      name: column_name,
      type: data_type,
    }));
    if (!metadata.length) {
      report.tables[spec.name] = { state: "absent", columns: [] };
      report.coverage.absent.push(spec.name);
      if (spec.required)
        report.blockers.push({
          table: spec.name,
          code: "required_table_absent",
        });
      continue;
    }
    const fields = new Map(columns.map(({ name, type }) => [name, type]));
    const required = spec.field ? [spec.field] : ["lease_until"];
    const unavailableChecks = spec.optional.filter(
      (field) => !fields.has(field),
    );
    const unsupportedColumns = [
      ...required,
      ...spec.optional.filter((field) => fields.has(field)),
    ].filter((field) => fields.get(field) !== columnType(field));
    const relationKind = metadata[0].relation_kind;
    if (!["r", "p"].includes(relationKind) || unsupportedColumns.length) {
      report.tables[spec.name] = {
        state: "unsupported",
        relationKind,
        columns,
        unsupportedColumns,
      };
      report.coverage.unsupported.push(spec.name);
      report.blockers.push({ table: spec.name, code: "unsupported_schema" });
      continue;
    }
    const query = aggregateQuery(spec, fields);
    const { rows } = await client.query(query.sql);
    const summary = summarize(spec, rows, query.metrics);
    report.tables[spec.name] = {
      state: "checked",
      relationKind,
      columns,
      unavailableChecks,
      ...summary,
    };
    report.coverage.checked.push(spec.name);
    if (unavailableChecks.length) report.coverage.partial.push(spec.name);
    report.blockers.push(...activityBlockers(spec, summary));
    report.durableWork[spec.name] = Object.fromEntries(
      spec.durable.map((state) => [state, summary.statuses[state]]),
    );
  }
  if (report.blockers.length) report.activity = "blocked";
  return report;
}

/** Inspect one read-only snapshot; provide either a Pool or an already connected client. */
export async function inspectLegacyReleaseActivity({ pool, client } = {}) {
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
    failure = inspectionError(error);
    if (began) {
      try {
        await connection.query("rollback");
      } catch (rollbackError) {
        failure = new AggregateError(
          [failure, inspectionError(rollbackError)],
          "Activity inspection and rollback failed",
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
              [failure, inspectionError(releaseError)],
              "Activity inspection could not release its connection",
            )
          : inspectionError(releaseError);
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
      "DATABASE_URL must be supplied explicitly; no env file is loaded.",
    );
  let address;
  try {
    address = new URL(value);
  } catch {
    throw new DatabaseUrlError(
      "DATABASE_URL must be an explicit loopback PostgreSQL URL.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(address.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname) ||
    !address.pathname ||
    address.pathname === "/"
  )
    throw new DatabaseUrlError(
      "DATABASE_URL must target an explicit loopback PostgreSQL database.",
    );
  if (address.search || address.hash)
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
    application_name: "helstera-legacy-release-activity",
  });
  let failure;
  let report;
  pool.on("error", (error) => {
    failure = failure
      ? new AggregateError(
          [failure, inspectionError(error)],
          "Activity pool connection failed",
        )
      : inspectionError(error);
  });
  try {
    report = await inspectLegacyReleaseActivity({ pool });
  } catch (error) {
    failure = failure
      ? new AggregateError(
          [failure, inspectionError(error)],
          "Activity inspection failed",
        )
      : inspectionError(error);
  } finally {
    try {
      await pool.end();
    } catch (closeError) {
      failure = failure
        ? new AggregateError(
            [failure, inspectionError(closeError)],
            "Activity connection shutdown failed",
          )
        : inspectionError(closeError);
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
          code: "activity_inspection_failed",
          message:
            error instanceof DatabaseUrlError
              ? error.message
              : "Legacy activity inspection failed.",
          ...(sqlState ? { sqlState } : {}),
        },
      })}\n`,
    );
    process.exitCode = 1;
  });
}
