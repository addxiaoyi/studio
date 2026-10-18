# Official Model Pricing

The public `/model-pricing/` page compares provider-published API rates with Helstera's configured per-generation credit estimate. These are separate billing systems and currencies; the page does not infer a savings percentage.

## Data sources

- Google Gemini API pricing: public documentation page; image-resolution and Veo 3.1 variants are parsed from the official page.
- MiniMax Open Platform: H3 768P and 2K per-second generation rates are read from official pricing rows.
- Replicate: Kling v2.6 billing tiers are read from the model page's embedded structured billing data.
- OpenAI image generation: the official guide snapshot is displayed with its source link. The current server egress receives HTTP 403, so it is not presented as automatically refreshed.

## Refresh and failure behavior

The API seeds known official snapshots on first read, attempts automatic sources at startup, then retries every 24 hours. Only fixed source URLs are fetched. A redirect is followed once and only when it remains on the same host. Parsers require known model and unit markers before any prices are written.

Each source is stored independently. A failed fetch or parser change updates source status but leaves its previous verified prices untouched. The public catalog exposes source status and successful verification time; it never exposes raw response bodies or credentials.

Apply the `official_model_prices` and `official_model_price_sources` tables from `apps/server/src/local-db/schema.sql` before starting the API release. `pnpm --filter @helstera/server db:migrate:local` applies the local schema.

## Price interpretation

Official image estimates vary by resolution, quality, prompt tokens, and reference inputs. Video estimates are normalized to per-second and five-second reference prices where available. Helstera values are credits per configured output; one credit is approximately CNY 1. The page keeps USD and credits side by side instead of asserting equivalence or guaranteed savings.
