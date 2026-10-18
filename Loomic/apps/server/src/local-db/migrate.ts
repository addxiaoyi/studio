import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for local database migration");

export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export function migrationVersion(fileName: string): string {
  return fileName.replace(/\.sql$/i, "");
}

export async function applyLocalMigrations(pool: pg.Pool, migrationsDir: string): Promise<string[]> {
  const files = (await readdir(migrationsDir, { withFileTypes: true }))
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
          throw new Error(`Migration checksum mismatch for ${version}. Restore the original migration or create a new version.`);
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
