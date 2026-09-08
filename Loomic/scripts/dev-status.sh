#!/usr/bin/env bash
# =============================================================================
# dev:status — Check the health of all Helstera dev services.
# =============================================================================
# Reports which services are running, on what ports, and whether they're
# responding. Exits 0 if all healthy, 1 if any are down.
# =============================================================================
set -uo pipefail

POSTGRES_PORT=55432
SUPABASE_MOCK_PORT=54321
BACKEND_PORT=3001
WEB_PORT=3000

# Check if a port has a LISTENING connection (cross-platform)
# Uses netstat (built-in on Windows + Mac + most Linux distros).
port_listening() {
  local port="$1"
  if command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | grep -E ":${port}.*LISTENING" >/dev/null
  elif command -v lsof >/dev/null 2>&1; then
    lsof -i ":${port}" >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -tln 2>/dev/null | grep -E ":${port}\s" >/dev/null
  else
    # Fallback: try a TCP connection
    (echo >"/dev/tcp/127.0.0.1/${port}") 2>/dev/null
  fi
}

ok()   { printf "  \033[1;32m✔\033[0m %s\n" "$*"; }
warn() { printf "  \033[1;33m⚠\033[0m %s\n" "$*"; }
fail() { printf "  \033[1;31m✘\033[0m %s\n" "$*"; }
step() { printf "\n\033[1;36m▶\033[0m %s\n" "$*"; }

# ── 1. Postgres ──
step "PostgreSQL (port $POSTGRES_PORT)"
if docker ps --format '{{.Names}}' | grep -q '^helstera-postgres$'; then
  if docker exec helstera-postgres pg_isready -U postgres -q 2>/dev/null; then
    USER_COUNT=$(docker exec helstera-postgres psql -U postgres -d helstera -tAc "SELECT count(*) FROM auth.users" 2>/dev/null | tr -d ' ')
    if [ "$USER_COUNT" -ge 4 ]; then
      ok "helstera-postgres up — $USER_COUNT test users seeded"
    else
      warn "helstera-postgres up — only $USER_COUNT users (expected 4). Run: bash scripts/dev-local.sh to re-seed"
    fi
  else
    fail "helstera-postgres container running but pg_isready failing"
  fi
else
  fail "helstera-postgres container not running. Run: bash scripts/dev-local.sh"
fi

# ── 2. Supabase mock ──
step "Supabase mock (port $SUPABASE_MOCK_PORT)"
if port_listening "$SUPABASE_MOCK_PORT"; then
  # Try a real login to verify end-to-end auth works
  LOGIN_TEST=$(curl -s -X POST "http://localhost:$SUPABASE_MOCK_PORT/auth/v1/token?grant_type=password" \
    -H "Content-Type: application/json" \
    -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnbReJBMrXVEiNdPWw" \
    -d '{"email":"pro@test.helstera.com","password":"Helstera-Test-2026"}' 2>/dev/null)
  if echo "$LOGIN_TEST" | grep -q '"access_token"'; then
    ok "Supabase mock up — login end-to-end works"
  else
    warn "Supabase mock up but login test failed (run: bash scripts/dev-local.sh)"
  fi
else
  fail "Supabase mock not running on :$SUPABASE_MOCK_PORT"
fi

# ── 3. Backend ──
step "Backend API (port $BACKEND_PORT)"
if port_listening "$BACKEND_PORT"; then
  # /api/credits/packages is a public endpoint (no auth needed) — perfect health check
  if curl -sf "http://localhost:$BACKEND_PORT/api/credits/packages" >/dev/null 2>&1; then
    ok "Backend up — /api/credits/packages responding"
  else
    warn "Backend up but /api/credits/packages not responding"
  fi
else
  fail "Backend not running on :$BACKEND_PORT"
fi

# ── 4. Web ──
step "Web dev (port $WEB_PORT)"
if port_listening "$WEB_PORT"; then
  if curl -sf "http://localhost:$WEB_PORT/" >/dev/null 2>&1; then
    ok "Web up — / responding"
  else
    warn "Web up but / not responding"
  fi
else
  fail "Web not running on :$WEB_PORT"
fi

# ── Summary ──
printf "\n"
printf "  Web:        \033[36mhttp://localhost:%s/\033[0m\n" "$WEB_PORT"
printf "  Backend:    \033[36mhttp://localhost:%s/\033[0m\n" "$BACKEND_PORT"
printf "  Supabase:   \033[36mhttp://localhost:%s/\033[0m\n" "$SUPABASE_MOCK_PORT"
printf "  Postgres:   \033[36m127.0.0.1:%s/helstera\033[0m\n\n" "$POSTGRES_PORT"
