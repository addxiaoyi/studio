# Helstera Local Development

## Production Web Static Update

The desktop Web shell loads `https://studio.0st.top/`. Publish only the exported Web tree with the isolated static updater; it does not install dependencies, run database migrations, or restart PM2 services.

Build and verify locally first:

```powershell
pnpm --filter @helstera/shared build
pnpm --filter @helstera/web build
python -m unittest scripts.test_deploy_web_static
python scripts/deploy-web-static.py --dry-run
```

The publisher requires the production password in `HELT_DEPLOY_PASSWORD`, and the jump/target host keys must already be trusted in `known_hosts`. Do not pass credentials on the command line or paste them into chat. After credentials are provisioned in the secure shell environment, run:

```powershell
python scripts/deploy-web-static.py
```

It archives the current `/www/helstera/apps/web/out`, uploads the candidate beside that directory, verifies the uploaded SHA-256, and atomically exchanges directories with Linux `renameat2`. It verifies the public `/desktop/` JS contains the canvas-first and code/MCP secondary-entry markers. A failed public verification triggers an atomic exchange back; the dated backup under `/www/helstera/backups` is retained. No server API, database, worker, PM2, or Nginx config is changed.

The development stack uses only local PostgreSQL, local filesystem storage, the Fastify API, the local Worker, and the Next.js web app.

## Quick Start

```bash
bash scripts/dev-local.sh
bash scripts/dev-status.sh
bash scripts/dev-stop.sh
```

The script starts PostgreSQL on port `55432`, applies `apps/server/src/local-db/schema.sql`, seeds local accounts, then starts the API and web app.

## Services

| Service | Port | Description |
| --- | ---: | --- |
| Web | 3000 | Next.js UI |
| API | 3001 | Fastify API and WebSocket |
| PostgreSQL | 55432 | Local application database |

## Test Accounts

All seeded accounts use password `Helstera-Test-2026`:

- `free@test.helstera.com`
- `starter@test.helstera.com`
- `pro@test.helstera.com`
- `ultra@test.helstera.com`

## Local Configuration

Set `DATABASE_URL`, `STORAGE_PROVIDER=local`, `STORAGE_ROOT`, and `NEXT_PUBLIC_AUTH_PROVIDER=local` in `.env.local`. The browser uses the local `helstera_session` cookie; no hosted auth, hosted Storage, or external database emulator is started.

## Logs and State

```text
/tmp/helstera-logs/   web.log, backend.log, seed.log
/tmp/helstera-pids/   process ids used by dev-stop.sh
```

Use `bash scripts/dev-clean.sh` to remove the dedicated PostgreSQL container and volume.
