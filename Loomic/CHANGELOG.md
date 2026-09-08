# Changelog

All notable changes to **Helstera** are documented here.

Format: [Semantic Versioning](https://semver.org/)

## [Unreleased] — 2026

### 🎨 Design Language
- **Glassmorphism design system** — 3-tier glass surfaces (soft/default/strong) with backdrop-blur + saturate
- **Editorial typography** — display utility classes (display-xl/lg/md/sm), eyebrow, body-relaxed
- **Refined color tokens** — replaced chartreuse with restrained indigo + accent
- **Dark mode** — comprehensive CSS variables with `:is(.dark)` selectors
- **Hairline borders** — `border-border/40`, `border-foreground/10` (replaces 1px hard borders)
- **Soft elevation** — 5-tier shadow scale (soft/card/hover/float/accent-glow)
- **Light type** — font-weight 300-500 dominates, body uses 400, display 500

### ♻️ Removed
- **Subscription system** — fully replaced with top-up credit model
  - `PLAN_CONFIGS` alias → deprecated
  - `dailyCredits` auto-claim → removed
  - `currentPeriodCredits` → removed
  - `grantMonthlyCredits` (Lemon Squeezy path) → deprecated
  - `@credits-system` task tag → removed

### ✨ New Features
- **Top-up system** — 4 packages (体验包/标准包/专业包/商务包)
  - Lemon Squeezy for international (USD)
  - YeePay (易支付) for China market (CNY)
- **PWA support**
  - Service Worker v2 with offline.html fallback
  - `PWAInstallPrompt` (3s dwell, 14-day suppression)
  - offline.html with glass design
- **Contact Sales** — `/api/contact-sales` with Supabase `contact_inquiries` table
- **Region-aware checkout**
  - Auto-detect `navigator.language` for China users
  - Manual override (International USD / 中国大陆 CNY)

### 🔒 Security
- HSTS (Strict-Transport-Security) with 1y max-age + includeSubDomains
- Permissions-Policy disabling unused APIs (camera/microphone/geolocation)
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- X-DNS-Prefetch-Control: on

### ♿ Accessibility (WCAG 2.1 AA)
- Global focus-visible ring (2px outline + offset)
- `prefers-reduced-motion` automatically disables animations
- Skip-to-content link in workspace layout
- ARIA labels on icon-only buttons
- 404 page with 3 recovery actions
- `error.tsx` and `global-error.tsx` boundaries
- Copy error digest button

### 📈 Performance
- Image optimization (AVIF + WebP) with 30-day cache
- Device-aware image sizes (640-3840px)
- 1-year immutable cache for `/images/*` and brand assets
- `optimizePackageImports` for lucide-react / framer-motion / @helstera/shared
- `next/dynamic` lazy loading for landing page sections
- Compression enabled

### 🔍 SEO
- JSON-LD structured data (Organization + SoftwareApplication)
- robots.txt blocking API/canvas/settings
- Theme color for mobile browser chrome
- metadataBase for OG image resolution
- OpenGraph + Twitter Card metadata

### 📊 Observability
- **Error reporter** — captures `error` + `unhandledrejection` with breadcrumb trail
  - sendBeacon + fetch(keepalive) double-fallback
  - 20-step breadcrumb ring buffer
- **Web Vitals** — native PerformanceObserver (no extra dep)
  - LCP, CLS, FCP, TTFB, INP
  - Web.dev standard thresholds
- Both reporters auto-install via `Providers` component

### 🧪 Tests
- 78+ unit tests across packages
- E2E (Playwright) — landing, pricing, auth, a11y
- TypeScript strict mode (exactOptionalPropertyTypes)

### 🛠️ Infrastructure
- Supabase migrations:
  - `20260904000000_yeepay_orders.sql` — YeePay orders + events
  - `20260904000001_contact_inquiries.sql` — Contact sales leads
  - `20260904000003_credit_topups.sql` — Unified topup ledger

### 📝 Documentation
- `docs/HELSTERA-DESIGN.md` — full design language spec
- Playwright config + 4 E2E specs
- ErrorReporter / WebVitals / PWAInstallPrompt are documented inline
