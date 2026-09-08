# Helstera Architecture

A high-level map of how the system fits together. Use this as onboarding material
for new contributors.

## System Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                          Browser (User)                            │
│  Next.js 15 (App Router) · React 19 · TypeScript · Tailwind 4    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Landing Page   │  │  Pricing / Buy  │  │  Workspace App  │  │
│  │  /              │  │  /pricing        │  │  /home /canvas  │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │              │
│           └───────── 1. React client components ───────────────  │
│                              │                                    │
│  ┌───────────────────────────▼──────────────────────────────┐    │
│  │       lib/api/*.ts (typed fetchers + Supabase)             │    │
│  │       lib/error-reporter.ts · lib/web-vitals.ts          │    │
│  │       providers (Theme · Auth · ErrorReporter · WebVitals)│    │
│  └───────────────────────────┬──────────────────────────────┘    │
└──────────────────────────────┼─────────────────────────────────┘
                                │ HTTPS
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                    Server: Fastify 5 (Node 22)                     │
│  src/                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  http/          │  │  agent/          │  │  features/      │  │
│  │  - auth         │  │  - tools         │  │  - bootstrap     │  │
│  │  - projects     │  │  - runtime       │  │  - credits       │  │
│  │  - canvas       │  │  - backends/     │  │  - payments/     │  │
│  │  - chat         │  │    state         │  │    lemon-squeezy │  │
│  │  - generate     │  │    filesystem    │  │    yeepay        │  │
│  │  - brand-kit    │  │  - persistence   │  │  - skills        │  │
│  │  - payments     │  │    - postgres     │  │  - bootstrap     │  │
│  │  - yeepay       │  │  - skills        │  │                  │  │
│  │  - credits      │  │  - prompts       │  │                  │  │
│  │  - ws           │  │                  │  │                  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                    │
│  WebSocket:  /api/ws  (real-time agent events)                    │
└──────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  Supabase (Postgres + Auth + Storage + PGMQ)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  profiles    │  │  projects    │  │  brand_kits / assets     │ │
│  │  workspaces  │  │  canvases    │  │  credit_topups            │ │
│  │  subscribers │  │  runs        │  │  credit_transactions      │ │
│  │  skills      │  │  jobs (PGMQ) │  │  contact_inquiries        │ │
│  │  yeepay_*    │  │  messages    │  │  yeepay_orders            │ │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## Layers

### 1. **Web (Next.js 15)**

```
apps/web/src/
├── app/                  # Next.js App Router (routes)
│   ├── (workspace)/      # Auth-gated workspace
│   ├── contact-sales/     # Public contact form
│   ├── pricing/           # Public topup page
│   ├── register/ login/   # Auth pages
│   ├── page.tsx           # Landing page (dynamic-imported sections)
│   ├── error.tsx          # Route error boundary
│   ├── global-error.tsx   # Top-level error boundary
│   └── not-found.tsx      # 404 page
│
├── components/
│   ├── landing/           # Hero, FeatureShowcase, HowItWorks, ...
│   ├── empty-state.tsx    # Reusable empty UI
│   ├── skeleton.tsx       # Reusable loading placeholders
│   ├── toast.tsx          # Glass-strong toast
│   ├── providers.tsx      # Theme + Auth + ErrorReporter + WebVitals
│   ├── error-reporter.ts  # (file renamed from error-reporter.tsx)
│   ├── pwa-install-prompt.tsx
│   ├── app-sidebar.tsx     # Workspace sidebar
│   ├── canvas/            # Excalidraw + custom elements
│   ├── chat/              # Chat sidebar, message blocks
│   ├── credits/           # Credit balance, topup dialog, tier badges
│   └── ui/                # shadcn/ui + custom (Button, Dialog, ...)
│
├── lib/
│   ├── api/               # Typed server-API clients
│   ├── auth-context.tsx   # Supabase auth context
│   ├── error-reporter.ts  # In-house error reporter
│   ├── web-vitals.ts      # PerformanceObserver reporter
│   ├── supabase-*.ts      # Supabase client factories
│   └── i18n.ts            # Locale dictionary (zh-CN / en-US)
│
└── e2e/                   # Playwright tests
    ├── landing.spec.ts
    ├── pricing.spec.ts
    ├── auth.spec.ts
    └── a11y.spec.ts
```

### 2. **Server (Fastify 5)**

```
apps/server/src/
├── http/                  # Fastify route handlers
│   ├── auth.ts            # /api/auth/*
│   ├── projects.ts        # /api/projects/*
│   ├── canvas.ts          # /api/canvas/*
│   ├── generate.ts        # /api/generate/*
│   ├── credits.ts         # /api/credits/topup
│   ├── payments.ts        # Lemon Squeezy checkout
│   ├── yeepay.ts          # YeePay Native/QR
│   ├── contact-sales.ts   # /api/contact-sales
│   └── ...
│
├── agent/                 # LangGraph-based agent
│   ├── tools/             # image_generate, video_generate, etc.
│   ├── backends/          # state (postgres) or filesystem
│   ├── persistence/       # checkpointer, store
│   ├── prompts/           # system prompts
│   └── runtime.ts         # run lifecycle
│
├── features/
│   ├── payments/
│   │   ├── lemon-squeezy-client.ts
│   │   ├── yeepay-client.ts        # NEW
│   │   ├── yeepay-service.ts       # NEW
│   │   └── payment-service.ts
│   ├── credits/           # balance, topup, transactions
│   ├── brand-kits/        # color/font/asset CRUD
│   ├── bootstrap/         # auto-provision workspace + subscription
│   └── skills/            # skill management
│
├── generation/
│   ├── providers/         # google / openai / volces / metaso / replicate
│   └── utils.ts           # aspect ratio, pricing
│
├── supabase/              # admin + user factories
├── ws/                    # WebSocket handler
└── app.ts                 # Fastify app builder
```

### 3. **Shared (TypeScript types + constants)**

```
packages/shared/src/
├── credits.ts       # TopupPackage, credit math, pricing
├── contracts.ts     # Zod schemas shared with web
├── brand-kit-contracts.ts
├── job-contracts.ts
├── skill-contracts.ts
├── events.ts        # WebSocket event types
├── http.ts          # Health/error response shapes
└── supabase/database.ts  # generated Supabase types
```

## Key Subsystems

### Payment Flow

```
                   ┌────────────────────┐
                   │ User clicks "购买"  │
                   └────────┬───────────┘
                            ▼
       ┌────────────────────────────────────────┐
       │ Pricing page: detect region (lang/tz)   │
       └────┬─────────────────────────┬────────┘
            │                         │
   China:   │                         │  International:
            ▼                         ▼
   ┌──────────────┐         ┌──────────────────────┐
   │ YeePayDialog │         │ createTopupCheckout    │
   │ + QR code    │         │ (Lemon Squeezy URL)    │
   │ + 30 min     │         └─────────┬─────────────┘
   │ + poll 2.5s  │                   │
   └────┬─────────┘                   │
        │                             │
        ▼                             ▼
   ┌──────────────────────────────────────────┐
   │   /api/yeepay/webhook         /api/payments/webhook  │
   │   verify HMAC                verify HMAC              │
   │   mark order paid            create subscription      │
   │   grant topup credits        (legacy, kept for compat)│
   └──────────────────────────────────────────┘
```

### Auth Flow

```
Browser ── /login ──> Supabase Auth ── cookie ──> /home
                                                  │
                                                  ▼
                                            AuthProvider (Context)
                                            ↓
                                            Workspace layout
```

### Agent Run (WebSocket)

```
Browser → POST /api/runs  →  run created (postgres)
                  ↘         ↗
                   WebSocket
            events streamed back
```

## Data Model Highlights

| Table | Purpose | Lifecycle |
|-------|---------|-----------|
| `workspaces` | Tenant root | Created on signup |
| `subscriptions` | Plan tracking (legacy, kept for compat) | One per workspace |
| `credit_topups` | Unified topup orders | Created on `/api/credits/topup` |
| `credit_transactions` | Immutable ledger (earn/spend) | Append-only |
| `yeepay_orders` | YeePay provider-specific | Created on `createYeePayOrder` |
| `payment_events` | Lemon Squeezy webhook log | Append-only |
| `contact_inquiries` | Enterprise sales leads | Created on form submit |

## Boundaries

- **Web → Server**: HTTPS only. CORS restricted to `HELSTERA_WEB_ORIGIN`.
- **Web → Supabase**: Direct via anon key + RLS. Service role NEVER reaches the browser.
- **Server → Supabase**: Admin client (service role) for privileged ops.
- **WebSocket**: Single `/api/ws` connection per browser tab, multiplexed events.

## Why this architecture?

1. **Streaming-first** — agents stream events over WebSocket, so the UI feels responsive
   even on long generations.
2. **Credit topup > subscription** — no recurring billing, users buy as they go,
   lower friction for international users.
3. **Provider plug-in** — image/video/payment providers all implement small interfaces,
   easy to add Stripe / Alipay / WeChat Pay later.
4. **TypeScript end-to-end** — same `TopupPackage` type on web + server, no drift.
