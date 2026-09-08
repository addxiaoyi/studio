#!/usr/bin/env bash
# =============================================================================
# dev-stop — Tear down everything started by scripts/dev-local.sh.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="/tmp/helstera-pids"

step() { printf "\033[1;36m▶\033[0m %s\n" "$*"; }
ok()   { printf "  \033[1;32m✔\033[0m %s\n" "$*"; }

stop_service() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      # Kill the process group (e.g. pnpm + child) for clean shutdown
      kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      ok "Stopped $name (pid $pid)"
    fi
    rm -f "$pidfile"
  fi
}

step "Stopping Helstera dev services"
stop_service "web"
stop_service "backend"
stop_service "supabase-mock"

# Stop helstera-postgres container only if we created it (not reused docker-db_postgres-1)
if [ -f "$PID_DIR/postgres-created" ]; then
  step "Stopping helstera-postgres container"
  docker stop helstera-postgres >/dev/null 2>&1 && ok "Stopped container helstera-postgres" || true
  rm -f "$PID_DIR/postgres-created"
fi

# Also kill any stray next dev / node processes that were spawned
if command -v lsof >/dev/null 2>&1; then
  for port in 3000 3001 54321; do
    pids=$(lsof -ti ":$port" 2>/dev/null || true)
    for pid in $pids; do
      kill "$pid" 2>/dev/null && ok "Killed stray process on :$port (pid $pid)" || true
    done
  done
fi

ok "All dev services stopped"
