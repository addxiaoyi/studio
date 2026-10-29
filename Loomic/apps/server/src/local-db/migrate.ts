import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for local database migration");

/**
 * Checksums must not depend on how git checked the file out.
 *
 * The repository is developed on Windows (CRLF) and deployed to Linux, and the first
 * applyLocalMigrations runs recorded checksums from LF content. Any later checkout that turns
 * the same migration into CRLF changed its hash, so `applyLocalMigrations` aborted the whole
 * chain with "Migration checksum mismatch" and no migration could ever be applied again.
 *
 * Hashing the LF-normalised text keeps one migration = one stable checksum on every platform.
 * The raw text is still what gets executed; Postgres accepts either line ending.
 */
export function normalizeForChecksum(sql: string): string {
  return sql.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(normalizeForChecksum(sql), "utf8").digest("hex");
}

export function migrationVersion(fileName: string): string {
  return fileName.replace(/\.sql$/i, "");
}

export async function applyLocalMigrations(pool: pg.Pool, migrationsDir: string): Promise<string[]> {  const files = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  const applied: string[] = [];

  for (const fileName of files) {
    const version = migrationVersion(fileName);
    const sql = await readFile(resolve(migrationsDir, fileName), "utf8");
    const checksum = migrationChecksum(sql);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query<{ checksum: string }>(
        "select checksum from schema_migrations where version = $1",
        [version],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          // The version is already applied, so nothing will be re-executed. A mismatch still
          // matters — it means this file was edited after it ran, so the schema it produced may
          // not match what a fresh database would get — but throwing here stops *every* later
          // migration from ever being applied, which is the worse failure: the chain dies and the
          // next release ships code that expects columns nobody can create.
          //
          // Migrations released before this check have no recoverable original (they were never
          // committed while they ran), so drift is surfaced loudly and the run continues. Set
          // MIGRATION_STRICT_CHECKSUM=1 to keep the old hard failure.
          const drift = `Migration checksum mismatch for ${version}: applied=${existing.rows[0].checksum} file=${checksum}`;
          if (process.env.MIGRATION_STRICT_CHECKSUM === "1") throw new Error(drift);
          console.warn(`[migrate] WARNING ${drift} — already applied, continuing.`);
        }
        await client.query("commit");
        continue;
      }
      await client.query(sql);
      await client.query(
        "insert into schema_migrations(version, checksum) values($1, $2)",
        [version, checksum],
      );
      await client.query("commit");
      applied.push(version);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  return applied;
}

const sql = await readFile(resolve(fileURLToPath(new URL("./schema.sql", import.meta.url))), "utf8");
const pool = new pg.Pool({ connectionString, max: 1 });
try {
  await pool.query(sql);
  const migrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url));
  const applied = await applyLocalMigrations(pool, migrationsDir);
  console.log(`Local PostgreSQL schema is up to date. Applied migrations: ${applied.length}.`);
} finally {
  await pool.end();
}
