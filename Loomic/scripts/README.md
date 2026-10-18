# Helstera Local Development

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
