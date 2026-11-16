import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Windows checkout line endings must not change the identity of an applied migration.
export function normalizeForChecksum(sql: string): string {
  return sql.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

export function migrationChecksum(sql: string): string {
  return createHash("sha256")
    .update(normalizeForChecksum(sql), "utf8")
    .digest("hex");
}

export function migrationVersion(fileName: string): string {
  return fileName.replace(/\.sql$/i, "");
}

class MigrationRollbackError extends AggregateError {}

async function assertMigrationScope(
  client: pg.PoolClient,
  schema: string,
  requireLedger: boolean,
) {
  const scope = (
    await client.query<{ schema: string | null; ledger_schema: string | null }>(
      `select current_schema() as schema,
      (select n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where c.oid=to_regclass('schema_migrations')) as ledger_schema`,
    )
  ).rows[0];
  if (
    !scope ||
    scope.schema !== schema ||
    (scope.ledger_schema !== null && scope.ledger_schema !== schema) ||
    (requireLedger && scope.ledger_schema === null)
  ) {
    throw new Error(
      "Migration ledger must belong to the locked target schema; check search_path before retrying",
    );
  }
}

async function withMigrationLock<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient, schema: string) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let key: string | undefined;
  let locked = false;
  let discard: Error | undefined;
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    const scope = (
      await client.query<{ key: string; schema: string | null }>(
        "select hashtextextended(current_database() || ':' || current_schema() || ':helstera-local-migrations',0)::text as key,current_schema() as schema",
      )
    ).rows[0];
    key = scope?.key;
    if (!key || !scope?.schema)
      throw new Error("Cannot identify the migration database and schema");
    // A session lock spans per-file commits and keeps bootstrap DDL in the same boundary.
    await client.query("select pg_advisory_lock($1::bigint)", [key]);
    locked = true;
    // Check after waiting: a bootstrapper may have created the ledger while we waited.
    await assertMigrationScope(client, scope.schema, false);
    outcome = { ok: true, value: await work(client, scope.schema) };
  } catch (error) {
    outcome = { ok: false, error };
    // A failed rollback can leave transaction state unknown even if unlock later succeeds.
    if (!locked || error instanceof MigrationRollbackError)
      discard = error instanceof Error ? error : new Error(String(error));
  }
  try {
    if (locked) {
      const unlocked = await client.query<{ unlocked: boolean }>(
        "select pg_advisory_unlock($1::bigint) as unlocked",
        [key],
      );
      if (unlocked.rows[0]?.unlocked !== true)
        throw new Error("Migration session lock was not held during release");
    }
  } catch (error) {
    // Never return a connection which may still own a session lock to its pool.
    discard = error instanceof Error ? error : new Error(String(error));
    outcome = {
      ok: false,
      error: outcome.ok
        ? error
        : new AggregateError(
            [outcome.error, error],
            "Migration and lock release both failed",
          ),
    };
  } finally {
    client.release(discard);
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

async function applyMigrations(
  client: pg.PoolClient,
  migrationsDir: string,
  schema: string,
): Promise<string[]> {
  await assertMigrationScope(client, schema, true);
  const ledger = `"${schema.replaceAll('"', '""')}".schema_migrations`;
  const files = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  const applied: string[] = [];

  for (const fileName of files) {
    const version = migrationVersion(fileName);
    const sql = await readFile(resolve(migrationsDir, fileName), "utf8");
    const checksum = migrationChecksum(sql);
    try {
      await client.query("begin");
      await assertMigrationScope(client, schema, true);
      const existing = await client.query<{ checksum: string }>(
        `select checksum from ${ledger} where version = $1`,
        [version],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          // Legacy drift remains visible without reapplying SQL or rewriting its receipt.
          const drift = `Migration checksum mismatch for ${version}: applied=${existing.rows[0].checksum} file=${checksum}`;
          if (process.env.MIGRATION_STRICT_CHECKSUM === "1")
            throw new Error(drift);
          console.warn(
            `[migrate] WARNING ${drift} — already applied, continuing.`,
          );
        }
        await client.query("commit");
        continue;
      }
      await client.query(sql);
      await assertMigrationScope(client, schema, true);
      await client.query(
        `insert into ${ledger}(version, checksum) values($1, $2)`,
        [version, checksum],
      );
      await client.query("commit");
      applied.push(version);
    } catch (error) {
      try {
        await client.query("rollback");
      } catch (rollbackError) {
        throw new MigrationRollbackError(
          [error, rollbackError],
          `Migration rollback failed for ${version}`,
        );
      }
      throw error;
    }
  }
  return applied;
}

export async function applyLocalMigrations(
  pool: pg.Pool,
  migrationsDir: string,
): Promise<string[]> {
  return withMigrationLock(pool, (client, schema) =>
    applyMigrations(client, migrationsDir, schema),
  );
}

export async function applyLocalSchema(
  pool: pg.Pool,
  schemaPath: string,
  migrationsDir: string,
): Promise<string[]> {
  const sql = await readFile(schemaPath, "utf8");
  return withMigrationLock(pool, async (client, schema) => {
    try {
      await client.query("begin");
      await client.query(sql);
      await assertMigrationScope(client, schema, true);
      await client.query("commit");
    } catch (error) {
      try {
        await client.query("rollback");
      } catch (rollbackError) {
        throw new MigrationRollbackError(
          [error, rollbackError],
          "Schema bootstrap rollback failed",
        );
      }
      throw error;
    }
    return applyMigrations(client, migrationsDir, schema);
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL is required for local database migration");
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const migrationsDir = fileURLToPath(
      new URL("./migrations/", import.meta.url),
    );
    const applied = await applyLocalSchema(
      pool,
      fileURLToPath(new URL("./schema.sql", import.meta.url)),
      migrationsDir,
    );
    console.log(
      `Local PostgreSQL schema is up to date. Applied migrations: ${applied.length}.`,
    );
  } finally {
    await pool.end();
  }
}
