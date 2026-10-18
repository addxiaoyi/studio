import pg from "pg";
import { probeConfiguredModelCalls } from "./model-call-probe.js";

if (!process.env.DATABASE_URL) {
  console.log(JSON.stringify({ networkCalls: 0, skipped: true, reason: "DATABASE_URL is not configured" }));
  process.exit(0);
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const rows = await probeConfiguredModelCalls(db);
  console.log(JSON.stringify({ networkCalls: 0, rows }, null, 2));
} finally {
  await db.end();
}
