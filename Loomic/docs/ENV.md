# Environment Variables

All environment variables used by Helstera across the monorepo.

## Server (apps/server)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HELSTERA_SERVER_PORT` | | `3001` | HTTP server port |
| `HELSTERA_WEB_ORIGIN` | | `http://localhost:3000` | Web origin for CORS |
| `HELSTERA_SKILLS_ROOT` | | `../../skills` | Path to skills directory |
| `HELSTERA_AGENT_BACKEND_MODE` | | `state` | `state` (postgres checkpoint) or `filesystem` |
| `HELSTERA_AGENT_MODEL` | | `openai:gpt-4.1` | Format: `provider:model-id` |
| `OPENAI_API_KEY` | | | OpenAI API key (also enables DALL·E 3, GPT Image) |
| `OPENAI_API_BASE` | | | Custom OpenAI endpoint (proxies) |
| `GOOGLE_API_KEY` | | | Google AI key (Imagen, Veo, Gemini) |
| `REPLICATE_API_TOKEN` | | | Replicate — adds 13 video/image models |
| `METASO_API_KEY` | | | Metaso (豆包 H3) |
| `METASO_API_BASE` | | `https://metaso.cn/api/minimax/` | Metaso H3 V2 base URL |
| `GOOGLE_APPLICATION_CREDENTIALS` | | | Path to Vertex AI service account JSON |
| `GOOGLE_VERTEX_PROJECT` | | | GCP project ID |
| `GOOGLE_VERTEX_LOCATION` | | | GCP region (e.g. us-central1) |
| `SUPABASE_URL` | ✓ | | Supabase project URL |
| `SUPABASE_ANON_KEY` | ✓ | | Anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | | Service role (server-only) |
| `SUPABASE_DB_URL` | ✓ | | Direct postgres URL for PGMQ worker |
| `SUPABASE_PROJECT_ID` | ✓ | | Project ref (for JWT verification) |
| `SUPABASE_JWT_SECRET` | ✓ | | JWT verification secret (ES256 JWK) |

## Payments — Lemon Squeezy (International / USD)

| Variable | Required | Description |
|----------|----------|-------------|
| `LEMON_SQUEEZY_STORE` | | Store ID |
| `LEMON_SQUEEZY_API_KEY` | ✓ | API key |
| `LEMON_SQUEEZY_WEBHOOK_SECRET` | ✓ | HMAC verification for `/api/payments/webhook` |
| `LEMON_SQUEEZY_TOPUP_VARIANT_STARTER_PACK` | | Topup variant IDs from LS dashboard |
| `LEMON_SQUEEZY_TOPUP_VARIANT_STANDARD_PACK` | |  |
| `LEMON_SQUEEZY_TOPUP_VARIANT_PRO_PACK` | |  |
| `LEMON_SQUEEZY_TOPUP_VARIANT_BUSINESS_PACK` | |  |

## Payments — YeePay / 易支付 (China / CNY)

| Variable | Required | Description |
|----------|----------|-------------|
| `YEEPAY_MERCHANT_ID` | ✓ | 商户号 |
| `YEEPAY_APP_KEY` | ✓ | 应用 Key |
| `YEEPAY_APP_SECRET` | ✓ | 应用 Secret (HMAC) |
| `YEEPAY_BASE_URL` | | `https://api.yeepay.com` |
| `YEEPAY_WEBHOOK_SECRET` | ✓ | 异步通知验签密钥 |
| `YEEPAY_NOTIFY_URL` | | Override `https://${WEB_ORIGIN}/api/yeepay/webhook` |

When **any** of the required YeePay envs are missing, the YeePay routes
do not register — the international Lemon Squeezy flow is unaffected.

## Web (apps/web)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_SERVER_BASE_URL` | `http://localhost:3001` | API server URL (browser-visible) |
| `NEXT_PUBLIC_SUPABASE_URL` | | Supabase project URL (browser-visible) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | | Anon key (browser-visible) |
| `NEXT_PUBLIC_WEB_ORIGIN` | `https://helstera.com` | Used by metadata for OG image resolution |

## Worker (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_CODE_CONCURRENCY` | `3` | Concurrent code jobs |
| `WORKER_IMAGE_CONCURRENCY` | `3` | Concurrent image jobs |
| `WORKER_VIDEO_CONCURRENCY` | `2` | Concurrent video jobs |
| `WORKER_POLL_INTERVAL_MS` | `2000` | PGMQ poll interval |
| `WORKER_MAX_BATCH_SIZE` | `10` | Max jobs per worker tick |

## Misc

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_FONTS_API_KEY` | | Brand kit font picker |
| `VOLCES_API_KEY` | | TTS provider |
| `VOLCES_BASE_URL` | | TTS endpoint |
| `GLOBAL_AGENT_HTTP_PROXY` | | HTTP proxy for outbound (e.g. `http://127.0.0.1:7890`) |

## Setup checklist

- [ ] Copy `.env.example` to `.env.local` (web) and `.env.local` (server)
- [ ] Fill `SUPABASE_*` vars (required for auth + DB)
- [ ] Add at least one AI provider key (`OPENAI_API_KEY` or `GOOGLE_API_KEY`)
- [ ] For production: configure `LEMON_SQUEEZY_*` (international) OR `YEEPAY_*` (China)
- [ ] For monitoring: set `NEXT_PUBLIC_WEB_ORIGIN` so OG image URLs resolve
- [ ] Run `pnpm install` to materialize workspace links
- [ ] Run `pnpm --filter @helstera/shared build` (must be first to generate types)

## Notes

- All `NEXT_PUBLIC_*` vars are bundled into the browser — never put secrets there.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — only use in server-side code.
- Currency conversion (`USD ↔ CNY`) uses a static 7.2 rate by default.
  Override via `getUsdCentsForCnyFen` in `packages/shared/src/credits.ts`.
