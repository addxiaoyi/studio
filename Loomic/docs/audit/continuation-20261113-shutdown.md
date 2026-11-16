# 2026-11-13 Shutdown recovery checkpoint evidence

This note records isolated-worktree evidence only. No production database, Nginx, PM2, or deployment credentials were used.

## Implementation

- Active running jobs receive the `worker_shutdown_waiting` stage before a worker reports a drained receipt.
- Shutdown checkpoints are deduplicated by job ID and do not change job status, progress, billing, provider checkpoints, or retry count.
- Queue messages returned after shutdown begins are released instead of being executed.
- Queue lease-release failures fail shutdown; the worker still attempts queue, maintenance, OneTake, and database cleanup before reporting failure.
- A message that starts during the shutdown window is included in the active-job tracking set and checkpoints itself before execution.

## Verification

- Server TypeScript check: passed with `tsc -p apps/server/tsconfig.json --noEmit`.
- Native Node behavior smoke test for checkpoint deduplication and late queue-message release: passed with Node 26 `--experimental-strip-types`.
- The first restricted Vitest attempt was blocked by `spawn EPERM`; the isolated rerun passed capacity policy, storage probe, media admission, worker readiness, shutdown checkpoint, queue runner, process receipt, WebSocket drain, and local job-service suites (37 tests).
- Shutdown recovery now distinguishes an explicit graceful-stop checkpoint from an unmarked stale job. A marked job is requeued immediately on startup; unmarked work still waits through the 10-minute idle grace period, and stale video keeps its 30-minute failure ceiling.
- The new recovery query passed against a disposable PostgreSQL 17 cluster: graceful checkpoint and stale job recovered, active video and exhausted attempts were preserved, expired video failed, and a second recovery pass changed nothing. The temporary loopback-only cluster was stopped and removed; the installed PostgreSQL service was not contacted.
- Shutdown tracking begins only after this Worker wins the atomic job claim, preventing duplicate queue deliveries from checkpointing another Worker's job. Reference-counted tracking also keeps repeated deliveries from removing a still-active ID too early; a post-claim checkpoint covers the shutdown/claim race.
- PostgreSQL recovery plus shutdown-tracker and queue-drain tests passed together (10 tests); Server typecheck passed.
- `scripts/test_release_desktop.py`, `scripts/test_storage_retention.py`, blue-green release, upstream switch, release topology, and deployment-candidate tests passed together (90 tests; 2 platform skips). Their SSH/deployment operations use mocks or local temporary fixtures; no production host was contacted.
- The desktop remote-installer retention helper now returns a review plan and never invokes `--apply`; regression tests cover both populated and empty plans. `git diff --check` passed.

## Release gate hardening

- The default deployment health URL now uses `/api/health/ready`, and the single-instance fallback polls the same dependency readiness endpoint. The public switch gate therefore checks database, storage, and accepting state instead of only the always-live liveness endpoint.
- Blue-green release tests passed (20 tests), and the default health-gate regression passed.

## Worker process and heartbeat verification

- Added `runtime/worker-process.postgres.test.ts`. It starts separate Node processes using the production Worker bootstrap, local PostgreSQL queue, job service, recovery query, heartbeat updates, shutdown handler and ready/drained receipts. Only the external job operation is replaced by a deterministic fixture that saves a checkpoint and writes an output file; no external model or paid request runs.
- `startWorker` is now exported without auto-starting on import. Running `src/worker.ts` directly retains its existing startup and fatal-error behavior. A separate process test launches that actual entry, checks its ready receipt, kills it and verifies it cannot claim a safe drain. The other tests use the same bootstrap instead of recreating its lifecycle.
- A running task keeps the shutdown stage through later heartbeats. The Worker remains un-drained until the output and completion state are saved. Restarting afterward leaves its attempt, submission and completion counts at one.
- Killing a Worker after checkpointing leaves its receipt un-drained. A new process immediately recovers the task, reuses the fixture's saved provider checkpoint, and creates one final output. This proves restart plumbing, not a real vendor's submission idempotency or billing.
- Two simultaneously running Workers contend through the real queue and atomic claim. Stopping the idle peer cannot mark the owner's job as shutting down; only the claimant checkpoints it and completes it once.
- Windows + PostgreSQL 17: four process tests passed, together with recovery, queue, tracker and job-service tests (22 tests). Windows uses test-only IPC to invoke the production SIGTERM handler because it cannot deliver POSIX signals. The same suite uses native SIGTERM/SIGKILL on Linux and is now required by Agent Closure CI; the remote Linux run has not been executed in this session.
- Capacity/readiness regressions passed separately (21 tests), including PostgreSQL concurrency, expiration, cancellation and release. Capacity values are injected in the test; these are not current production disk measurements.
- Release/retention and CI-config regressions: 92 tests run, 90 passed and 2 platform skips. SSH/deployment calls in these unit suites are mocks or local fixtures. Server typecheck and `git diff --check` passed.
- Temporary PostgreSQL cleanup: all test schemas and client sessions were gone before shutdown; `pg_ctl` stopped the dedicated cluster, its PID file disappeared and port 58489 was no longer listening. Automatic command policy rejected recursive removal even after verifying the exact directory, so the stopped cluster files remain at `D:/UserCache/Temp/helstera-worker-pg-3cff52ee35de4e42848d70f4458ee205`. No alternate deletion mechanism was used; no production data or installed PostgreSQL service was touched.

## Remaining gate

Run native Linux signal delivery against this full Worker bootstrap, then combine it with the real Nginx/PM2 handoff and continuous HTTP/WebSocket checks. Vendor-accepted work with an unknown outcome still needs separate recovery and billing evidence. Recheck current production disk/headroom, process receipts and deployed versions before any production deployment. Deployment credentials were absent from this process environment; no SSH, production database operation or deployment was performed. The older machine-space readings in the 2026-11-10 audit remain historical, not current capacity evidence.

## Public read-only probe, 2026-11-13

Five unauthenticated HTTPS requests to `studio.0st.top`, with a 15-second per-request timeout:

- `/api/health`: HTTP 200, JSON `ok: true`, version `0.0.0-stability-20261110-1`.
- `/api/health/ready`: HTTP 200, JSON `ok: true`, with config/database/storage/accepting checks true.
- `/api/agent/browser/sessions`, `/api/agent/goals`, `/api/agent/connectors`: each returned HTTP 401 and JSON `ok: false`, error code `unauthorized`.

This sample did not reproduce the earlier 502; it is not a continuous-availability test and provides no byte-level production disk measurement, Nginx configuration inspection or authenticated browser evidence.
