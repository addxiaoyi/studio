#!/usr/bin/env bash
# =============================================================================
# dev:local — One-command Helstera local development environment.
# =============================================================================
#
# Boots:
#   1. PostgreSQL  (uses the running docker-db_postgres-1 container if
#                   available, otherwise starts a fresh one)
#   2. Helstera schema (auth/storage schema init + migrations + seed)
#   3. Backend API    (port 3001)   — apps/server
#   4. Web dev        (port 3000)   — apps/web
#
# Logs go to /tmp/helstera-logs/<service>.log
# PID files at /tmp/helstera-pids/
#
# Stop everything: scripts/dev-stop.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="/tmp/helstera-logs"
PID_DIR="/tmp/helstera-pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

POSTGRES_CONTAINER="helstera-postgres"
POSTGRES_PORT=55432
BACKEND_PORT=3001
WEB_PORT=3000

export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${POSTGRES_PORT}/helstera"
export STORAGE_PROVIDER="local"
export STORAGE_ROOT="${STORAGE_ROOT:-/www/helstera/uploads}"
export NEXT_PUBLIC_AUTH_PROVIDER="local"

# ── Pretty logging helpers ──
step() { printf "\033[1;36m▶\033[0m %s\n" "$*"; }
ok()   { printf "  \033[1;32m✔\033[0m %s\n" "$*"; }
warn() { printf "  \033[1;33m⚠\033[0m %s\n" "$*"; }
fail() { printf "  \033[1;31m✘\033[0m %s\n" "$*"; exit 1; }

# ── Sanity checks ──
command -v docker >/dev/null 2>&1 || fail "docker is required (https://docs.docker.com/get-docker/)"
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required (https://pnpm.io/installation)"
[ -f .env.local ] || fail ".env.local is missing. Copy from .env.example and fill in."

# ── 1. PostgreSQL ──
# Always use a dedicated `helstera-postgres` container on host port 55432.
# This keeps the dev DB isolated from any other local PostgreSQL
# (e.g. a Dify or another PostgreSQL service instance) that may be running on the host.
step "Starting PostgreSQL on port $POSTGRES_PORT"

if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  ok "Reusing existing container: $POSTGRES_CONTAINER"
else
  docker run -d --name "$POSTGRES_CONTAINER" \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -p "$POSTGRES_PORT:5432" \
    -v helstera-pgdata:/var/lib/postgresql/data \
    postgres:15-alpine >/dev/null
  touch "$PID_DIR/postgres-created"
  ok "Started container: $POSTGRES_CONTAINER"
  for i in {1..30}; do
    docker exec "$POSTGRES_CONTAINER" pg_isready -U postgres -q 2>/dev/null && break
    sleep 1
  done
fi

# ── 2. Database + schema init ──
step "Initializing Helstera database + schema"
if ! docker exec "$POSTGRES_CONTAINER" psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='helstera'" 2>/dev/null | grep -q 1; then
  docker exec "$POSTGRES_CONTAINER" psql -U postgres -c "CREATE DATABASE helstera" >/dev/null
  ok "Created database: helstera"
else
  ok "Database already exists: helstera"
fi

# Apply the canonical local PostgreSQL schema.
step "Applying local PostgreSQL schema"
docker exec -i "$POSTGRES_CONTAINER" psql -U postgres -d helstera -v ON_ERROR_STOP=1 < "$ROOT_DIR/apps/server/src/local-db/schema.sql" >/dev/null
ok "Local PostgreSQL schema is up to date"

step "Starting backend API on port $BACKEND_PORT"
BACKEND_LOG="$LOG_DIR/backend.log"
if lsof -i ":$BACKEND_PORT" >/dev/null 2>&1; then
  ok "Backend already running on :$BACKEND_PORT"
else
  pnpm --filter @helstera/server dev > "$BACKEND_LOG" 2>&1 &
  echo $! > "$PID_DIR/backend.pid"
  for i in {1..30}; do
    if curl -sf "http://localhost:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  ok "Backend ready on :$BACKEND_PORT (pid $(cat "$PID_DIR/backend.pid"))"
fi

# ── 5. Web ──
step "Starting web dev server on port $WEB_PORT"
WEB_LOG="$LOG_DIR/web.log"
if lsof -i ":$WEB_PORT" >/dev/null 2>&1; then
  ok "Web already running on :$WEB_PORT"
else
  pnpm --filter @helstera/web dev > "$WEB_LOG" 2>&1 &
  echo $! > "$PID_DIR/web.pid"
  for i in {1..30}; do
    if curl -sf "http://localhost:$WEB_PORT/" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  ok "Web ready on :$WEB_PORT (pid $(cat "$PID_DIR/web.pid"))"
fi

# ── 6. Seed test accounts ──
# The SQL seed is idempotent and uses the local app_users table.
step "Seeding test accounts"
SEED_LOG="$LOG_DIR/seed.log"
SEED_SQL="$ROOT_DIR/scripts/dev-seed-accounts.sql"
if docker exec -i "$POSTGRES_CONTAINER" psql -U postgres -d helstera -v ON_ERROR_STOP=0 -f - \
  < "$SEED_SQL" > "$SEED_LOG" 2>&1; then
  ok "Seeded 4 test accounts (pro, starter, ultra, free)"
else
  warn "SQL seed had errors — see $SEED_LOG"
fi

# ── Summary ──
printf "\n\033[1;32m========================================\n"
printf "  Helstera dev environment ready!\033[0m\n"
printf "\033[1;32m========================================\033[0m\n\n"

printf "  \033[1mWeb:\033[0m          \033[36mhttp://localhost:%s/\033[0m\n" "$WEB_PORT"
printf "  \033[1mBackend API:\033[0m  \033[36mhttp://localhost:%s/\033[0m\n" "$BACKEND_PORT"
printf "  \033[1mPostgres:\033[0m    \033[36mpostgresql://postgres:postgres@127.0.0.1:%s/helstera\033[0m\n\n" "$POSTGRES_PORT"

printf "  \033[1mTest accounts\033[0m (password: \033[33mHelstera-Test-2026\033[0m):\n"
printf "    free@test.helstera.com    — Free tier  (50 credits)\n"
printf "    starter@test.helstera.com — Starter    (1,200 credits)\n"
printf "    pro@test.helstera.com     — Pro        (5,000 credits)\n"
printf "    ultra@test.helstera.com   — Ultra      (15,000 credits)\n\n"

printf "  \033[2mLogs:\033[0m  $LOG_DIR/  (web.log, backend.log, seed.log)\n"
printf "  \033[2mPids:\033[0m  $PID_DIR/\n"
printf "  \033[2mStop:\033[0m  bash scripts/dev-stop.sh\n\n"
