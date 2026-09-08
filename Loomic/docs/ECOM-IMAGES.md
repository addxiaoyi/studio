# Ecom Images

> Batch image generation for e-commerce PDP / social / detail pages. 25 scene templates, prompt-engineering iron rules, multi-image style lock.

## 1. Overview

Ecom Images is a batch image generation pipeline that turns a product name and a short description into a consistent set of e-commerce ready images — white-background hero shots, lifestyle scenes, infographics, livestream frames, magazine editorials, and 20 more. It packages the ecom-details-image skill into a typed, polled, credit-metered service: the user picks 1-25 scenes, the system infers a conversion driver (visual / pain-point / emotional), applies a campaign style lock to keep multi-image sets visually consistent, and dispatches each scene to an image model provider (OpenAI / Google / Replicate). The product problem is that e-commerce sellers need 5-10 production-grade images per SKU and the cost + variance of generic image tools is too high. Ecom Images replaces that with a deterministic, branded pipeline where prompt structure, color palette, and product framing are constrained by iron rules so the output actually looks like a real product photo set.

## 2. Quick Start

Five-step path from page to generation:

1. **Open the workspace page** — navigate to `/ecom-images` in the Next.js app. The page lives at `apps/web/src/app/(workspace)/ecom-images/page.tsx` and renders a 3-column layout: product info (left), scene grid (right), generated results (below).
2. **Fill product info** — enter the product name (required) and an optional longer description. The description feeds the conversion-driver heuristic and the auto style-lock picker.
3. **Pick scenes** — search/select from the 25 categorized scene templates (产品 / 营销 / 信息). Each card shows English + Chinese name. Multiple scenes can be selected; each one becomes one generated image.
4. **Configure ratio and reference image** — choose an aspect ratio (defaults to the scene's `defaultRatio`) and optionally upload a reference image for visual grounding. The reference is sent as `inputImages` to the provider.
5. **Click generate** — `POST /api/ecom/jobs` is fired with `{ productName, productDescription, sceneIds, ratio, referenceImageUrl }`. The service builds prompts, infers style lock, inserts a row into `ecom_jobs` with status `pending`, and dispatches generation in the background. The client polls `GET /api/ecom/jobs/:id` and renders results as they land.

```ts
// Minimal client invocation
const res = await fetch("/api/ecom/jobs", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    productName: "Midea Air Purifier",
    productDescription: "HEPA filter, 99.97% PM2.5 removal",
    sceneIds: ["01-hero-image", "02-lifestyle-scene", "11-infographic"],
    ratio: "1:1",
  }),
});
const { job } = await res.json();
// poll /api/ecom/jobs/:id until status === "succeeded" | "failed"
```

## 3. 25 Scene Templates

Templates live in `packages/shared/src/ecom/templates.ts`. Each template has a stable kebab-case id, English and Chinese name, a default aspect ratio, and a structured prompt with negative constraints and anti-AI tips.

| ID | Category | Name (EN) | Name (ZH) | Default Ratio | Description |
|----|----------|-----------|-----------|---------------|-------------|
| `01-hero-image` | 产品 | Hero Image | 白底主图 | 1:1 | Clean white-background product hero. The PDP anchor. |
| `02-lifestyle-scene` | 产品 | Lifestyle Scene | 场景图 | 3:2 | Product in a real-world context. Drives "this fits my life". |
| `03-flat-lay` | 产品 | Flat Lay | 平铺 | 1:1 | Top-down overhead with arranged complementary props. |
| `04-detail-macro` | 产品 | Detail Macro | 特写微距 | 4:3 | Extreme close-up on a feature (texture, mechanism, branding). |
| `05-poster-banner` | 营销 | Poster Banner | 海报横幅 | 3:2 | Marketing poster with bold typography. For ads and banners. |
| `06-social-media` | 营销 | Social Media | 小红书 / Instagram | 4:5 | Vertical 4:5 post. iPhone-photo feel, not studio. |
| `07-ugc-style` | 营销 | UGC Style | 用户晒单 | 4:5 | Authentic user-generated-content. Phone photo, warm tungsten. |
| `08-model-showcase` | 产品 | Model Showcase | 模特上身 | 3:4 | Human model wearing or holding the product. |
| `09-before-after` | 信息 | Before / After | 对比 | 16:9 | Two-panel transformation comparison. |
| `10-packaging` | 产品 | Packaging | 包装 | 4:3 | Unboxing shot with all packaging elements. |
| `11-infographic` | 信息 | Infographic | 信息图 | 2:3 | PDP A+ infographic with icons, headlines, CTA placeholder. |
| `12-creative-concept` | 营销 | Creative Concept | 创意概念 | 16:9 | Artistic / surreal concept for brand campaigns. |
| `13-size-spec` | 信息 | Size Spec | 规格表 | 1:1 | Spec sheet with measurements, weight, dimensions. |
| `14-multi-product` | 产品 | Multi-Product | 组合套装 | 1:1 | Bundle set. Drives AOV. |
| `15-livestream` | 营销 | Livestream | 直播 | 9:16 | Vertical live-stream frame with reserved overlay zones. |
| `16-try-on-virtual` | 产品 | Virtual Try-On | 虚拟试穿 | 3:4 | Apparel on a model without a photoshoot. |
| `17-exploded-view` | 信息 | Exploded View | 爆炸图 | 4:3 | All parts separated in 3D. Technical products. |
| `18-ghost-mannequin` | 产品 | Ghost Mannequin | 人台 / 隐形模特 | 3:4 | Apparel shown as worn but with invisible body. |
| `19-multi-angle-grid` | 产品 | Multi-Angle Grid | 多角度 | 1:1 | 4-6 angles of the same product in a grid. |
| `20-magazine-editorial` | 营销 | Magazine Editorial | 杂志大片 | 3:4 | High-fashion editorial. Vogue-spread feel. |
| `21-seasonal-campaign` | 营销 | Seasonal Campaign | 季节性营销 | 16:9 | Holiday/seasonal themed campaign. |
| `22-luxury-atmospherics` | 营销 | Luxury Atmosphere | 轻奢高级感 | 3:4 | Premium feel with smoke, dark backdrop, controlled light. |
| `23-device-mockup` | 信息 | Device Mockup | 样机 | 16:9 | App or website shown on a device. For SaaS products. |
| `24-storefront` | 营销 | Storefront | 店铺 | 16:9 | Retail / e-commerce storefront display. |
| `25-sports-campaign` | 营销 | Sports Campaign | 运动 | 16:9 | Sports / fitness / outdoor. Energy, motion, performance. |

## 4. Prompt Assembly Rules

The prompt builder (`packages/shared/src/ecom/prompt-builder.ts`) enforces a strict set of iron rules so prompts produce predictable, on-brand output. Violations are surfaced as warnings in logs but do not block generation.

### 4.1 Hex Colors Only

All colors must be expressed as hex (`#FFFFFF`, `#1A1A1A`, `#0A2540`). Named colors ("white", "charcoal") are forbidden because providers inconsistently interpret them. The `validateIronRules` function checks for at least one hex token.

### 4.2 Product Size as Percentage

Product framing must be specified as a percentage of the frame. Default rules per purpose:

| Purpose | Product Size | Use Case |
|---------|--------------|----------|
| `hero` | 40% | Primary PDP image |
| `benefit` | 28% | Benefit-focused frames |
| `lifestyle` | 22% | Lifestyle context shots |
| `feedAd` | 40% | Social feed ads |
| `search` | 45% | Search result images |
| `sku` | 65% | SKU / spec shots |

### 4.3 Explicit Whitespace

Every prompt must declare whitespace. The minimum is 45% (`IRON_RULES.minWhitespace`). Hero scenes default to 50% whitespace. `validateIronRules` parses any `whitespace at least N%` token and rejects values below the threshold.

### 4.4 Negative Constraints

Every template carries a `negativeConstraints` array returned alongside the prompt. Standard negatives across the registry: no fake brand logos, no fake certifications, no AI-rendered text, no watermarks, no price tags, no humans (unless apparel).

### 4.5 Reserved Zones

Two zones are reserved by convention so the downstream team can overlay text and branding without colliding with the product:

| Zone | Coordinates | Purpose |
|------|-------------|---------|
| `topCenterPrice` | top center 200x100 | Price tag overlay |
| `topLeftLogo` | top-left 200x100 | Brand logo overlay |

`validateIronRules` checks for a `top-(left\|center\|right) \d+` token in the prompt.

### 4.6 Multi-Image Style Lock

When a job requests multiple scenes, the service applies a `CampaignStyleLock` — a consistent opening paragraph prefixed to every prompt in the batch. The lock bundles:

- `palette[]` — 2-3 brand colors in hex
- `accent` — accent color in hex
- `colorTemperature` — e.g. `warm 3500K`, `cool 6500K`
- `lightDirection` — e.g. `45-degree top-left, soft fill from below`
- `fontSystem` — e.g. `Inter / Source Han Sans`
- `background` — solid or pattern
- `layout` — `centered`, `rule-of-thirds`, etc.
- `iconStyle` — `outline 1.5px stroke`, `filled flat 1px stroke`
- `productRules` — free-text rules for product depiction
- `forbiddenDrift[]` — items the model must not introduce

The lock is formatted by `formatStyleLock()` and prepended to every prompt, ensuring visual consistency across the batch.

## 5. API Reference

All endpoints live under `/api/ecom`. Authentication is required for write endpoints; `GET /api/ecom/scenes` is public.

### 5.1 `GET /api/ecom/scenes`

List all 25 scene templates. Public.

**Request** — no parameters.

**Response**

```json
[
  {
    "id": "01-hero-image",
    "name": "Hero Image",
    "nameZh": "白底主图",
    "triggers": ["hero", "packshot", "主图", "白底"],
    "defaultRatio": "1:1",
    "description": "Clean white-background product hero shot..."
  }
]
```

### 5.2 `POST /api/ecom/jobs`

Create a batch generation job. The service builds prompts, infers style lock, charges credits, and dispatches generation in the background.

**Request**

```json
{
  "productName": "Midea Air Purifier",
  "productDescription": "HEPA filter, 99.97% PM2.5 removal",
  "sceneIds": ["01-hero-image", "02-lifestyle-scene"],
  "ratio": "1:1",
  "referenceImageUrl": "https://example.com/product.jpg",
  "styleLock": { /* optional CampaignStyleLock, auto-inferred if omitted */ },
  "conversionDriver": "pain-point"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `productName` | string | yes | Product name, substituted into `{{product}}` |
| `productDescription` | string | no | Longer description, fed to driver heuristic |
| `sceneIds` | `SceneId[]` | yes | 1-25 scene ids from the registry |
| `ratio` | `EcomRatio` | no | Defaults to first scene's `defaultRatio` |
| `referenceImageUrl` | string | no | Reference image for grounding |
| `styleLock` | `CampaignStyleLock` | no | Auto-picked from product name + driver if omitted |
| `conversionDriver` | `"visual" \| "pain-point" \| "emotional"` | no | Auto-diagnosed if omitted |

**Response**

```json
{
  "job": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "pending",
    "creditsCharged": 20,
    "createdAt": 1725456000000
  },
  "prompts": [
    { "sceneId": "01-hero-image", "text": "...", "negatives": ["..."], "ratio": "1:1" }
  ]
}
```

### 5.3 `GET /api/ecom/jobs/:id`

Poll job status and per-scene outputs.

**Request** — `:id` is the job UUID.

**Response**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "progress": 50,
  "outputs": [
    { "sceneId": "01-hero-image", "url": "https://...", "error": null },
    { "sceneId": "02-lifestyle-scene", "url": null, "error": null }
  ],
  "creditsCharged": 20,
  "createdAt": 1725456000000,
  "completedAt": null
}
```

| Status | Meaning |
|--------|---------|
| `pending` | Row inserted, generation not yet started |
| `running` | At least one scene is being generated |
| `succeeded` | At least one scene succeeded (partial results allowed) |
| `failed` | All scenes failed |

### 5.4 `GET /api/ecom/jobs`

List recent jobs for a workspace. Used by the gallery view.

**Request**

| Query Param | Type | Default | Description |
|-------------|------|---------|-------------|
| `workspaceId` | string | required | Workspace to list jobs for |
| `limit` | number | 20 | Max jobs to return |

**Response** — array of `EcomJob` objects, newest first.

```json
[
  { "id": "...", "status": "succeeded", "productName": "...", "createdAt": 1725456000000 }
]
```

## 6. Database Schema

The `ecom_jobs` table (`supabase/migrations/20260904000004_ecom_jobs.sql`) stores one row per batch. Per-scene outputs are denormalized into a JSONB column for simple polling.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | `uuid` PK | Auto-generated job ID |
| `workspace_id` | `text` | Workspace that owns the job |
| `user_id` | `text` | User that triggered the job |
| `product_name` | `text` | Product name (required) |
| `product_description` | `text` | Optional longer description |
| `scene_ids` | `text[]` | Scene IDs requested (1-25) |
| `ratio` | `text` | Output aspect ratio, default `1:1` |
| `reference_image_url` | `text` | Optional reference image for grounding |
| `style_lock` | `jsonb` | Generated `CampaignStyleLock` |
| `conversion_driver` | `text` | `visual` / `pain-point` / `emotional` |
| `prompts` | `jsonb` | Assembled prompts, one per scene |
| `status` | `text` | `pending` / `running` / `succeeded` / `failed` |
| `outputs` | `jsonb` | Per-scene output URLs and errors, updated as scenes complete |
| `progress` | `integer` | 0-100 percentage, updated as scenes complete |
| `credits_charged` | `integer` | Total credits for this batch |
| `error_message` | `text` | Error message if `status = failed` |
| `created_at` | `bigint` | Creation timestamp (ms since epoch) |
| `completed_at` | `bigint` | Completion timestamp (ms since epoch) |

**Indexes**

- `ecom_jobs_workspace_idx` on `(workspace_id, created_at DESC)` — workspace gallery queries
- `ecom_jobs_user_idx` on `(user_id, created_at DESC)` — "my recent jobs" queries

**Constraints**

- `status` must be one of `pending` / `running` / `succeeded` / `failed`
- `conversion_driver` must be one of `visual` / `pain-point` / `emotional`

## 7. Conversion Driver Diagnosis

The `diagnoseConversionDriver()` heuristic picks a conversion driver from free-text product description. This drives the hero sequence template and the default style lock.

### 7.1 Pain-Point

Triggers when the description contains any of:

| Chinese | English |
|---------|---------|
| 问题, 困扰, 痛点, 解决, 修复, 治愈 | problem, solve, fix, repair, cure, pain, struggle |

Returns `confidence: 0.7` with rationale: "Detected pain-point language. Drives urgency and conversion."

The pain-point hero sequence is: `problem → mechanism → proof → trust → offer-urgency`.

### 7.2 Emotional

Triggers when the description contains any of:

| Chinese | English |
|---------|---------|
| 感觉, 体验, 身份, 自我, 感受, 情感 | feel, experience, identity, emotion, lifestyle, belong |

Returns `confidence: 0.7` with rationale: "Detected emotional/lifestyle language. Drives brand affinity and aspirational purchase."

The emotional hero sequence is: `hook → identity → product → status → offer-emotion`.

### 7.3 Visual (Default)

Falls through to visual when neither pain-point nor emotional signals match. Returns `confidence: 0.5` with rationale: "Default to visual driver: aesthetic and quality signals."

The visual hero sequence is: `claim → feature → scene → comparison → offer-cta`.

## 8. Style Lock Defaults

`defaultStyleLock(driver, variant)` returns one of three style locks. The variant parameter can override based on product category keywords detected by `pickStyleLock()`.

### 8.1 Luxury

| Field | Value |
|-------|-------|
| `palette` | `#1A1A1A`, `#F5F1E8`, `#FFFFFF` |
| `accent` | `#D4AF37` (gold) |
| `colorTemperature` | warm 3500K |
| `lightDirection` | 45-degree top-left, soft fill from below |
| `fontSystem` | thin sans-serif (Inter / Source Han Sans) |
| `background` | charcoal #1A1A1A with subtle vignette |
| `layout` | rule of thirds, generous negative space |
| `iconStyle` | outline 1.5px stroke, monoline |
| `productRules` | 30-40% of frame, soft shadow, no harsh reflections |

Picked when: `driver === "emotional"` OR `variant === "luxury"` (triggered by `watch` / `jewel` / `luxury` / `leather` / `gold` / `premium` keywords in product name).

### 8.2 Tech

| Field | Value |
|-------|-------|
| `palette` | `#FFFFFF`, `#0A2540`, `#00D4FF` |
| `accent` | `#00D4FF` (cyan) |
| `colorTemperature` | cool 6500K |
| `lightDirection` | soft overhead, rim from behind |
| `fontSystem` | modern sans-serif + monospace for spec |
| `background` | white with subtle gradient |
| `layout` | centered, diagrammatic |
| `iconStyle` | filled flat 1px stroke |
| `productRules` | 35% of frame, sharp, mid-action when applicable |

Picked when: `driver === "pain-point"` OR `variant === "tech"` (triggered by `tech` / `smart` / `device` / `gadget` / `electronic` / `app` keywords).

### 8.3 Fresh (Default)

| Field | Value |
|-------|-------|
| `palette` | `#FFFFFF`, `#E6F4EA`, `#1A1A1A` |
| `accent` | `#34C759` (green) |
| `colorTemperature` | neutral 5000K |
| `lightDirection` | soft daylight from a window |
| `fontSystem` | modern rounded sans-serif |
| `background` | white |
| `layout` | centered with light rule-of-thirds offset |
| `iconStyle` | rounded soft 2px stroke |
| `productRules` | 35% of frame, natural light shadow |

Picked when: `driver === "visual"` AND `variant === "default"` or `"minimal"`. Also triggered by `skincare` / `cosmetic` / `organic` / `natural` / `fresh` / `eco` keywords (in which case `variant = "fresh"` is passed but the same lock is returned since the visual/fresh/minimal branch is the fallback).

## 9. Integration Points

The service delegates image generation to `generateImage(providerName, options)` in `apps/server/src/generation/image-generation.ts`. Three provider paths are supported:

### 9.1 OpenAI

`providerName: "openai"` — calls OpenAI's image API. Default model is `gpt-image-1`. Supports `inputImages` for reference grounding. Returns `{ url, mimeType, width, height }`.

### 9.2 Google

`providerName: "google"` — calls Google's image generation API (Imagen / Gemini image). Same return shape. Aspect ratio passed via `aspectRatio`.

### 9.3 Replicate

`providerName: "replicate"` — calls Replicate's hosted models. Used for models not available on OpenAI / Google (e.g. Flux, SDXL variants).

The provider is auto-resolved from the `ECOM_DEFAULT_PROVIDER` environment variable. The model is resolved from `ECOM_DEFAULT_MODEL`. Aspect ratio and reference images are passed through.

```ts
const result = await generateImage("openai", {
  prompt: prompt.text,
  model: "gpt-image-1",
  aspectRatio: "1:1",
  inputImages: ["https://example.com/ref.jpg"],
});
```

## 10. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ECOM_DEFAULT_PROVIDER` | `openai` | Provider name passed to `generateImage()` |
| `ECOM_DEFAULT_MODEL` | `gpt-image-1` | Model id passed to `generateImage()` |
| `SUPABASE_URL` | — | Required. Supabase project URL for job persistence |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Required. Service role key for bypassing RLS |

`createEcomService()` returns `null` if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` are missing, so the service degrades gracefully when Supabase is not configured (the `/api/ecom/scenes` endpoint still works because it reads from the in-memory template registry).

## 11. Credit Cost

Default cost is **10 credits per image**. The total `creditsCharged` for a batch is `10 * sceneIds.length`. Configurable via `EcomServiceConfig.defaultCreditsPerImage` at construction time.

```ts
const creditsCharged = this.creditsPerImage * prompts.length;
```

Credits are charged at job creation time, not at completion. A job that fails on all scenes still consumes the credits. This matches the policy used by the rest of the platform (no refunds for failed generations; the model provider has already been paid).

## 12. Limits

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max scenes per job | 25 | Matches the scene registry size; 1 per template id |
| Min scenes per job | 1 | Service throws `no_scenes` error if `sceneIds` is empty |
| Max reference image size | 20MB | Provider-side limit; not enforced client-side yet |
| Polling interval | client-decided | Recommend 2-3s; the service has no rate limit on reads |

## 13. Failure Modes

### 13.1 OpenAI Key Missing

If `ECOM_DEFAULT_PROVIDER=openai` but `OPENAI_API_KEY` is not set, `generateImage()` throws an authentication error. The scene is marked as failed in `outputs[]` with the error message, and the loop continues to the next scene. The job's final status is `failed` if all scenes fail, `succeeded` if at least one succeeds.

### 13.2 Supabase Down

`supabase.from("ecom_jobs").insert(...)` throws on connection failure. The service surfaces this as `db_insert_failed` and the client receives a 500. No credits are charged because the insert failed before the charge was persisted. If Supabase goes down mid-generation, `updateStatus()` calls throw, but the job row remains in `running` state (orphaned). A reaper job or background worker would be needed to clean these up (see Future Work).

### 13.3 Rate Limited

If the provider returns a 429, `generateImage()` throws. The scene is marked as failed and the loop continues. No retry logic exists in the current implementation; a failed scene stays failed. The `outputs[]` array preserves the error message so the user can see which scenes failed and why.

### 13.4 Iron Rule Violations

If a built prompt violates iron rules (missing hex color, no percentage, no whitespace token, etc.), the violations are logged via `console.warn` but generation proceeds. The user is not blocked from generating. This is intentional: the templates are hand-curated to satisfy the rules, and violations typically come from user overrides.

## 14. Future Work

### 14.1 Asynchronous PGMQ Worker

Currently `runJob()` executes in-process after `createJob()` returns. A crash mid-batch orphans the job. Migrate to a PGMQ-based worker: insert a job message into a queue, have a separate worker process consume it, and emit status updates via WebSocket. This decouples job lifetime from the HTTP request and enables retries.

### 14.2 Style Lock Editor UI

Style locks are auto-inferred today. A dedicated editor would let users pick palette, accent, temperature, light direction, font system, and forbidden-drift items manually. The `CampaignStyleLock` type already supports all the required fields; only the UI is missing.

### 14.3 Per-Scene Job Rows

Today one `ecom_jobs` row wraps the whole batch, with per-scene results in `outputs[]`. A normalized schema (one `ecom_jobs` row per scene, with a `batch_id` foreign key) would simplify per-scene retries and partial refunds.

### 14.4 Real-Time Progress via WebSocket

The client polls `GET /api/ecom/jobs/:id` every 2-3s. A WebSocket channel (`/api/ws/ecom/:jobId`) would push progress events as each scene completes, reducing latency and server load.

### 14.5 A/B Testing Across Drivers

The conversion driver is auto-diagnosed but the user cannot override it from the UI. A toggle ("try pain-point framing") would let users compare visual / pain-point / emotional hero sequences side by side and pick the one that converts best for their product.

### 14.6 Template Hot-Reload

Templates are compiled into the shared package. A database-backed template registry would let the team add or revise scenes without a redeploy.

### 14.7 Scene Presets

Common bundles ("5-image PDP pack", "social media trio", "seasonal campaign") would one-click the scene selection and reduce time-to-generate for new users.

## Appendix A: Source Files

| Concern | File |
|---------|------|
| Types | `packages/shared/src/ecom/index.ts` |
| 25 templates | `packages/shared/src/ecom/templates.ts` |
| Prompt builder | `packages/shared/src/ecom/prompt-builder.ts` |
| Backend service | `apps/server/src/features/ecom-image/ecom-service.ts` |
| Frontend page | `apps/web/src/app/(workspace)/ecom-images/page.tsx` |
| DB migration | `supabase/migrations/20260904000004_ecom_jobs.sql` |

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Scene** | One of 25 pre-defined image templates. A scene defines a prompt skeleton, default ratio, and anti-AI tips. |
| **Style Lock** | A `CampaignStyleLock` object that prefixes every prompt in a multi-image batch to enforce visual consistency. |
| **Conversion Driver** | The dominant selling logic for a product: visual (aesthetic), pain-point (problem-solving), or emotional (identity). |
| **Hero Sequence** | A 5-step narrative template (`claim → feature → scene → comparison → offer-cta`) for the primary image set. |
| **PDP** | Product Detail Page. The main e-commerce listing page. |
| **Iron Rules** | The hard constraints every prompt must satisfy: hex colors, percentages, whitespace, negatives, reserved zones. |
