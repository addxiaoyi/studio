import pg from "pg";

const { Pool } = pg;

export function createLocalDbPool(connectionString: string) {
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}
