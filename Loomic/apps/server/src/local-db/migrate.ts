import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for local database migration");

const sql = await readFile(resolve(fileURLToPath(new URL("./schema.sql", import.meta.url))), "utf8");
const pool = new pg.Pool({ connectionString, max: 1 });
try {
  await pool.query(sql);
  console.log("Local PostgreSQL schema is up to date.");
} finally {
  await pool.end();
}
