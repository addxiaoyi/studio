# Local PostgreSQL tests

Use a disposable loopback PostgreSQL database and set `HELT_TEST_DATABASE_URL` in the invoking process. Do not point tests at an application database. Individual fixtures create their own schemas; some Agent goals tests create a separate database and require a local role with that permission.

From the Loomic project directory:

```powershell
node --test scripts/prepare-test-postgres.test.mjs
node scripts/test-local-postgres.mjs src/runtime/worker-process.postgres.test.ts

$tests = @(rg --files apps/server/src | Where-Object { $_ -like '*.postgres.test.ts' } | ForEach-Object { $_.Replace('\', '/').Substring(12) })
node scripts/test-local-postgres.mjs @tests
```

The runner prepares `public.pgcrypto` before starting at most four Vitest workers. Concurrent runner instances serialize extension preparation with a transaction advisory lock. A setup failure aborts the test run and closes the setup connection. Direct Vitest invocations must preinstall the shared extension themselves before running parallel schema fixtures.

Additional checks need explicit inputs: `HELT_AGENT_DB_TEST=1` with `DATABASE_URL` for Agent goals, `HELT_TEST_VIDEO_FILE` for actual MP4 delivery, `HELT_LIVE_CAPTURE_TEST=1` for public page recording, and `HELT_ELECTRON_TEST_BIN` for the actual Electron receipt fixture. Passing database tests does not prove a production deployment or real Electron rendering.
