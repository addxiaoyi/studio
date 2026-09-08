# Helstera Local Development

This directory contains one-command scripts to start a fully working
Helstera dev environment on your local machine.

## Quick Start

```bash
# Boot everything (PostgreSQL + supabase-mock + backend + web + seed)
bash scripts/dev-local.sh

# Verify all services are healthy
bash scripts/dev-status.sh

# Stop everything
bash scripts/dev-stop.sh
```

That's it. Open <http://localhost:3000> and sign in with one of the
test accounts below.

## Test Accounts

Password (all four accounts): **`Helstera-Test-2026`**

| Email                      | Plan     | Credits  | Use for testing             |
| -------------------------- | -------- | -------- | --------------------------- |
| `free@test.helstera.com`   | Free     | 50       | Free tier limits & paywall  |
| `starter@test.helstera.com` | Starter  | 1,200    | Starter features            |
| `pro@test.helstera.com`    | Pro      | 5,000    | Pro features (most users)   |
| `ultra@test.helstera.com`  | Ultra    | 15,000   | Heavy use / large projects  |

## Service Map

| Service       | Port | URL                                    | Notes                                    |
| ------------- | ---- | -------------------------------------- | ---------------------------------------- |
| Web (Next.js) | 3000 | <http://localhost:3000>               | UI — what users interact with            |
| Backend API   | 3001 | <http://localhost:3001>               | REST API, served via `pnpm --filter @helstera/server dev` |
| Supabase mock | 54321| <http://localhost:54321>              | Local Auth + REST + Storage emulator     |
| PostgreSQL    | 55432| `postgresql://postgres:postgres@127.0.0.1:55432/helstera` | Real PG in a dedicated Docker container |

## File Map

| File                                  | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `scripts/dev-local.sh`                | One-command start of the full dev stack                  |
| `scripts/dev-stop.sh`                 | One-command stop of all started services                  |
| `scripts/dev-status.sh`               | Health check of all services (port + login + endpoint)   |
| `scripts/dev-setup-sql.sql`           | Local auth/storage schema init (runs before migrations)  |
| `scripts/dev-seed-accounts.sql`       | Idempotent SQL seed of 4 test accounts (works around supabase-mock not implementing `/auth/v1/admin/users`) |
| `local-infra/supabase-mock/`          | Fastify + pg.JS implementation of the Supabase API surface |

## Why this complexity?

Helstera was designed to run against real Supabase. For local dev we
ship a **drop-in mock** that lives in `local-infra/supabase-mock/`.
The mock implements Auth (sign in / sign up / refresh), REST
(select / insert / update / delete), and Storage. It does **not**
implement every Supabase endpoint — most notably:

- `POST /auth/v1/admin/users` — so we seed accounts via raw SQL.
- `POST /rest/v1/rpc/<name>` — most RPCs work, but the
  `bootstrap_user_foundation` trigger path has edge cases.

For most flows (sign in, list projects, generate images, etc.) the
mock works fine. For flows that need bootstrap (e.g. first-time
workspace setup), use the SQL seed above which pre-populates the
required rows.

## Troubleshooting

### "lsof not found" warning in dev-status.sh

The status script auto-falls back to `netstat` on Windows. No action
needed.

### "Login: Invalid credentials"

The bcrypt hash in the seed SQL is computed at seed time. If you
reset the database and the seed didn't run, hashes will be wrong. Re-run:

```bash
docker exec -i helstera-postgres psql -U postgres -d helstera \
  -f scripts/dev-seed-accounts.sql
```

### Port 55432 in use

The dev script refuses to start if `helstera-postgres` is already
running. If you need a different port, edit `POSTGRES_PORT` in
`scripts/dev-local.sh` and the `SUPABASE_PG_PORT` env var in
`.env.local`.

### Backend keeps restarting (port 3001 already in use)

```bash
lsof -ti:3001 | xargs -r kill -9
# or on Windows:
powershell -Command "Get-NetTCPConnection -LocalPort 3001 -State Listen | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
```

Then re-run `bash scripts/dev-local.sh`.

## Where logs go

```
/tmp/helstera-logs/
├── web.log              # Next.js dev server stdout/stderr
├── backend.log          # Fastify API stdout/stderr
├── supabase-mock.log    # Mock Auth/REST/Storage stdout/stderr
└── seed.log            # psql output from the dev seed

/tmp/helstera-pids/      # PIDs for dev-stop.sh to clean up
```

## Adding a new test account

Edit `scripts/dev-seed-accounts.sql` and add a new branch to the `if i`
chain, then re-run:

```bash
docker exec -i helstera-postgres psql -U postgres -d helstera \
  -f scripts/dev-seed-accounts.sql
```
