#!/usr/bin/env bash
# =============================================================================
# dev:clean — Tear down dev environment and wipe all data.
# =============================================================================
# Removes the dedicated postgres container (along with all data),
# and the helstera-pgdata volume. Use this when you want a fresh start.
# Your supabase-mock / backend / web processes are NOT killed by this
# script — run `bash scripts/dev-stop.sh` first for that.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

step() { printf "\033[1;36m▶\033[0m %s\n" "$*"; }
ok()   { printf "  \033[1;32m✔\033[0m %s\n" "$*"; }
warn() { printf "  \033[1;33m⚠\033[0m %s\n" "$*"; }

# Stop dev processes first so they don't hold open file handles on the volume
if [ -f scripts/dev-stop.sh ]; then
  bash scripts/dev-stop.sh >/dev/null 2>&1 || true
fi

step "Removing helstera-postgres container"
if docker ps -a --format '{{.Names}}' | grep -q '^helstera-postgres$'; then
  docker rm -f helstera-postgres >/dev/null
  ok "Container removed"
else
  ok "No container to remove"
fi

step "Removing helstera-pgdata volume"
if docker volume ls --format '{{.Name}}' | grep -q '^helstera-pgdata$'; then
  docker volume rm helstera-pgdata >/dev/null
  ok "Volume removed — all test data wiped"
else
  ok "No volume to remove"
fi

step "Clearing PID + log files"
rm -rf /tmp/helstera-pids /tmp/helstera-logs
ok "Local state cleared"

printf "\n\033[1;32m✔ Fresh state. Run \033[36mbash scripts/dev-local.sh\033[32m to start over.\033[0m\n\n"
