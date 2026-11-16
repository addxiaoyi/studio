import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { prepareTestPostgres } from "./prepare-test-postgres.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (
  !process.env.HELT_TEST_DATABASE_URL &&
  existsSync(resolve(root, ".env.local"))
)
  loadEnvFile(resolve(root, ".env.local"));
const database = process.env.HELT_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (
  !database ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(database).hostname)
)
  throw new Error("Tests require an explicit local PostgreSQL connection.");
const files = process.argv.slice(2);
if (
  !files.length ||
  files.some(
    (file) =>
      !file.startsWith("src/") ||
      !file.endsWith(".test.ts") ||
      file.includes(".."),
  )
)
  throw new Error("Pass server src test paths.");
const requireServer = createRequire(resolve(root, "apps/server/package.json"));
const { Client } = requireServer("pg");
await prepareTestPostgres(
  new Client({ connectionString: database, connectionTimeoutMillis: 5000 }),
);
// Schema fixtures have isolated tables but share extension DDL and host resources.
const MAX_DATABASE_WORKERS = 4;
const tests = spawnSync(
  process.execPath,
  [
    resolve(root, "node_modules/vitest/vitest.mjs"),
    "run",
    "--maxWorkers",
    String(MAX_DATABASE_WORKERS),
    ...files,
  ],
  {
    cwd: resolve(root, "apps/server"),
    env: { ...process.env, HELT_TEST_DATABASE_URL: database },
    stdio: "inherit",
    windowsHide: true,
  },
);
if (tests.error) throw tests.error;
process.exit(tests.status ?? 1);
