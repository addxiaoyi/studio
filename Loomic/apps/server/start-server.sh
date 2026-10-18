#!/bin/sh

read_env() {
  grep "^$1=" /www/.env.local | head -n 1 | cut -d= -f2-
}

export PROVIDER_CONFIG_ENCRYPTION_KEY="$(read_env PROVIDER_CONFIG_ENCRYPTION_KEY)"
export OPENAI_API_KEY="$(read_env OPENAI_API_KEY)"
export OPENAI_API_BASE="$(read_env OPENAI_API_BASE)"
export HELSTERA_AGENT_MODEL="$(read_env HELSTERA_AGENT_MODEL)"
export HELSTERA_WEB_ORIGIN="$(read_env HELSTERA_WEB_ORIGIN)"
export EPAY_BASE_URL="$(read_env EPAY_BASE_URL)"
export EPAY_MERCHANT_ID="$(read_env EPAY_MERCHANT_ID)"
export EPAY_MD5_KEY="$(read_env EPAY_MD5_KEY)"

exec node --env-file=/www/.env.local --import tsx ./src/server.ts
