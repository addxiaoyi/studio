import { load } from "cheerio";
import type { Pool } from "pg";
import type {
  OfficialModelPrice,
  OfficialModelPriceCatalog,
  OfficialPriceSourceStatus,
} from "@helstera/shared";
import { USD_CNY_RATE } from "@helstera/shared";
import { isRemovedImageModelId } from "../generation/removed-models.js";

const SNAPSHOT_DATE = "2026-10-13";
const SOURCE_TIMEOUT_MS = 20_000;
const MAX_SOURCE_BYTES = 5_000_000;
const SEED_POOLS = new WeakSet<Pool>();

type SourceDefinition = {
  sourceId: string;
  label: string;
  url: string;
  automatic: boolean;
  parse: (html: string, checkedAt: string) => OfficialModelPrice[];
};

const SNAPSHOTS: OfficialModelPrice[] = [
  googleImage("google-flash-image-1k", "Nano Banana 2", "1K", 0.067, "google-official/gemini-3.1-flash-image-preview", 5),
  googleImage("google-flash-image-2k", "Nano Banana 2", "2K", 0.101, "google-official/gemini-3.1-flash-image-preview", 5),
  googleImage("google-flash-image-4k", "Nano Banana 2", "4K", 0.151, "google-official/gemini-3.1-flash-image-preview", 5),
  googleImage("google-pro-image-1k", "Nano Banana Pro", "1K / 2K", 0.134, "google-official/gemini-3-pro-image-preview", 8),
  googleImage("google-pro-image-4k", "Nano Banana Pro", "4K", 0.24, "google-official/gemini-3-pro-image-preview", 8),
  googleVideo("google-veo-31-720p", "Veo 3.1", "Standard · 720p / 1080p", 0.4, "google-official/veo-3.1-generate-preview", 50),
  googleVideo("google-veo-31-4k", "Veo 3.1", "Standard · 4K", 0.6, "google-official/veo-3.1-generate-preview", 50),
  {
    priceKey: "openai-gpt-image-1-standard-square",
    providerKey: "openai",
    providerLabel: "OpenAI API",
    modelId: "gpt-image-1",
    modelName: "GPT Image 1",
    mediaType: "image",
    variant: "Medium · 1024 × 1024",
    officialMin: 0.042,
    officialMax: 0.042,
    currency: "USD",
    unit: "per_image",
    unitLabel: "per image",
    helsteraCredits: 10,
    helsteraUnitLabel: "per image",
    note: "官方图像输出价；提示词和参考图输入 tokens 另计。模型目前已标记 Deprecated。",
    sourceId: "openai-images",
    sourceLabel: "OpenAI API 文档",
    sourceUrl: "https://developers.openai.com/api/docs/guides/image-generation",
    snapshotDate: SNAPSHOT_DATE,
    lastVerifiedAt: null,
  },
  {
    priceKey: "replicate-kling-v26-standard-pro",
    providerKey: "replicate",
    providerLabel: "Replicate",
    modelId: "kwaivgi/kling-v2.6",
    modelName: "Kling 2.6",
    mediaType: "video",
    variant: "API billing tiers",
    officialMin: 0.07,
    officialMax: 0.14,
    currency: "USD",
    unit: "per_second",
    unitLabel: "per second of output video",
    helsteraCredits: 40,
    helsteraUnitLabel: "per 5 seconds",
    note: "Replicate 官方页面列出多个计费档，具体费用随模型选项变化。",
    sourceId: "replicate-kling-v26",
    sourceLabel: "Replicate 官方模型页",
    sourceUrl: "https://replicate.com/kwaivgi/kling-v2.6",
    snapshotDate: SNAPSHOT_DATE,
    lastVerifiedAt: null,
  },
  minimaxVideo("minimax-h3-768p", "768P", 0.08),
  minimaxVideo("minimax-h3-2k", "2K", 0.13),
  wanVideo("wan3.0-1080p", "Wan 3.0", "1080P", 0.2, "wan3.0"),
  publicVideo("happyhorse-1.1-i2v-1080p", "HappyHorse 1.1 I2V", "1080P", 0.18, "happyhorse-1.1-i2v", "https://www.alibabacloud.com/help/en/model-studio/happyhorse-1-1-i2v"),
  publicVideo("happyhorse-1.1-r2v-1080p", "HappyHorse 1.1 R2V", "1080P", 0.18, "happyhorse-1.1-r2v", "https://www.alibabacloud.com/help/en/model-studio/happyhorse-1-1-r2v"),
  publicVideo("wan2.6-i2v-1080p", "Wan 2.6 I2V", "1080P", 0.15, "wan2.6-i2v", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"),
  publicVideo("wan2.6-r2v-1080p", "Wan 2.6 R2V", "1080P", 0.15, "wan2.6-r2v", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"),
  publicVideo("wan2.7-t2v-1080p", "Wan 2.7 T2V", "1080P", 1 / 7.2, "wan2.7-t2v", "https://help.aliyun.com/en/model-studio/wan2-7-t2v", "CNY 1.00 converted at USD/CNY 7.20"),
  publicVideo("pixverse-v6-1080p-audio", "PixVerse V6", "1080P with audio", 46 / 225, "pixverse-v6-shouweizhen", "https://docs.platform.pixverse.ai/pricing-796039m0", "46 credits/sec; PixVerse states $1 = 5 x 5-second 720P videos"),
  publicVideo("pixverse-v5.6-1080p-audio", "PixVerse V5.6", "1080P with audio", 150 / 1125, "pixverse-v5.6-r2v", "https://docs.platform.pixverse.ai/pricing-796039m0", "150 credits per 5 seconds; PixVerse states $1 = 5 x 5-second 720P videos"),
  publicVideo("viduq3-turbo-720p", "Vidu Q3 Turbo", "720P", 0.065, "viduq3-turbo-cankaosheng", "https://platform.vidu.com/docs/pricing"),
  seedanceVideo("seedance-2.0-anmiao", "seedance-2.0-anmiao"),
  seedanceVideo("seedance-2.0-anmiao-cankaosheng", "seedance-2.0-anmiao-cankaosheng"),
  seedanceVideo("seedance-2.0-anmiao-quannengcankao", "seedance-2.0-anmiao-quannengcankao"),
  seedanceVideo("seedance-2.0-guanfang-anmiao", "seedance-2.0-guanfang-anmiao"),
  tokenPrice("gpt-image-2-image-input-token", "GPT Image 2", "Image input tokens", 8, "gpt-image-2", "https://developers.openai.com/api/docs/pricing", "Standard API price; $8 per million image input tokens"),
  tokenPrice("gpt-image-2-cached-image-input-token", "GPT Image 2", "Cached image input tokens", 2, "gpt-image-2", "https://developers.openai.com/api/docs/pricing", "Standard API price; $2 per million cached image input tokens"),
  tokenPrice("gpt-image-2-image-output-token", "GPT Image 2", "Image output tokens", 30, "gpt-image-2", "https://developers.openai.com/api/docs/pricing", "Standard API price; $30 per million image output tokens. Actual output tokens vary by dimensions and quality."),
  tokenPrice("gpt-image-2-text-input-token", "GPT Image 2", "Text input tokens", 5, "gpt-image-2", "https://developers.openai.com/api/docs/pricing", "Standard API price; $5 per million text input tokens"),
  openaiImageEstimate("openai-gpt-image-2-1k-estimate", "GPT Image 2 1K", "1K", "gpt-image-2-1k", 0.006, 0.211),
  openaiImageEstimate("openai-gpt-image-2-2k-estimate", "GPT Image 2 2K", "2K", "gpt-image-2-2k", 0.024, 0.844),
  openaiImageEstimate("openai-gpt-image-2-4k-upscale-estimate", "GPT Image 2 4K Upscale", "4K upscale", "gpt-image-2-4k-����", 0.096, 3.376),
  openaiImageEstimate("openai-gpt-image-2-4k-estimate", "GPT Image 2 4K", "4K", "gpt-image-2-4k", 0.096, 3.376),
  openaiImageEstimate("openai-gpt-image-2-5-1k-estimate", "GPT Image 2.5 1K", "1K", "gpt-image-2.5-1k", 0.006, 0.211),
  openaiImageEstimate("openai-gpt-image-2-5-2k-estimate", "GPT Image 2.5 2K", "2K", "gpt-image-2.5-2k", 0.024, 0.844),
  openaiImageEstimate("openai-gpt-image-2-5-4k-estimate", "GPT Image 2.5 4K", "4K", "gpt-image-2.5-4k", 0.096, 3.376),
  openaiImageEstimate("openai-gpt-image-2-estimate", "GPT Image 2", "1K default", "gpt-image-2", 0.006, 0.211),
  minimaxAlias("minimax-h3-hailuo-2k", "Hailuo H3", "2K", 0.13, "hailuo-h3"),
  minimaxAlias("minimax-h3-hailuo-reference-2k", "Hailuo H3 Reference", "2K", 0.13, "hailuo-h3-cankaosheng"),
  publicVideo("kling-motion-control-1080p", "Kling Motion Control", "1080P public API reference", 0.135, "kling-motion-control", "https://dev.pika.art/models/kling/kling-3.0/motion-control/pricing", "Non-official API reference: Pika lists $0.135/s at 1080P. Kling's official app guide lists native 4K at 30 credits/s; no universal USD conversion is published."),
  publicVideo("vidu-q3-pro-1080p", "Vidu Q3 Pro", "1080P", 0.12, "viduq3-pro", "https://platform.vidu.com/docs/pricing", "Official 24 credits/s x official conversion $0.005/credit"),
  tokenPrice("seedance-2.5-1080p-token", "Seedance 2.5", "1080P output tokens", 11.7, "dreamina-seedance-2-5-260628", "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-pricing", "Official BytePlus ModelArk online rate; $11.70 per million tokens for 1080P without video input. Actual total depends on input/output duration and frame area.", "video"),
  suppliedVideo("supplied-hailuo-h3-max", "Hailuo H3 Max", "480P / 768P", 0.08, "hailuo-h3-max", "https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise"),
  suppliedVideo("supplied-hailuo-h3-max-first-last", "Hailuo H3 Max First/Last Frame", "480P / 768P", 0.08, "hailuo-h3-max-shouweizhen", "https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise"),
  suppliedVideo("supplied-hailuo-h3-reference", "Hailuo H3 Reference", "2K", 0.13, "hailuo-h3-quannengcankao", "https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise"),
  suppliedVideo("supplied-hailuo-h3-first-last", "Hailuo H3 First/Last Frame", "2K", 0.13, "hailuo-h3-shouweizhen", "https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise"),
  suppliedVideo("supplied-hailuo-h3-regeneration", "Hailuo H3 Regeneration", "2K", 0.13, "hailuo-h3-zaishengcheng", "https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise"),
  suppliedVideo("supplied-happyhorse-1-1-t2v", "HappyHorse 1.1 T2V", "1080P", 0.26, "happyhorse-1.1-t2v", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"),
  suppliedVideo("supplied-happyhorse-t2v", "HappyHorse T2V", "1080P", 0.26, "happyhorse-t2v", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"),
  suppliedVideo("supplied-happyhorse-i2v", "HappyHorse I2V", "1080P", 0.26, "happyhorse-i2v", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"),
  suppliedVideo("supplied-happyhorse-r2v", "HappyHorse R2V", "1080P", 0.26, "happyhorse-r2v", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"),
  suppliedVideo("supplied-happyhorse-video-edit", "HappyHorse Video Edit", "1080P", 0.26, "happyhorse-video-edit", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"),
  suppliedVideo("supplied-minimax-h3-max", "MiniMax H3 Max", "768P", 0.08, "minimax-h3-max", "https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise"),
  suppliedVideo("supplied-wan2-2-animate-mix-std", "Wan 2.2 Animate Mix", "Standard", 0.09, "wan2.2-animate-mix", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"),
  suppliedVideo("supplied-wan2-2-animate-mix-pro", "Wan 2.2 Animate Mix", "Pro", 0.13, "wan2.2-animate-mix", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"),
  suppliedVideo("supplied-kling-avatar", "Kling Avatar Image2Video", "Up to 1080P", 0.168, "kling-avatar-image2video", "https://klingai.com"),
  suppliedVideo("supplied-kling-motion-v3", "Kling Motion Control V3", "Up to 1080P", 0.168, "kling-motion-control-v3", "https://klingai.com"),
  suppliedVideo("supplied-kling-motion", "Kling Motion Control", "Up to 1080P", 0.168, "kling-motion-control", "https://klingai.com"),
  suppliedVideo("supplied-kling-omni-videoref", "Kling V3 Omni Video Reference", "4K", 0.42, "kling-v3-omni-videoref", "https://klingai.com"),
  suppliedVideo("supplied-wan3-video", "Wan 3.0 Video", "1080P", 0.28, "wan3.0-video", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"),
  suppliedVideo("supplied-wan3-video-reference", "Wan 3.0 Video Reference", "1080P", 0.28, "wan3.0-video-cankaosheng", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"),
  suppliedVideo("supplied-wan3-video-first-last", "Wan 3.0 Video First/Last Frame", "1080P", 0.28, "wan3.0-video-shouweizhen", "https://www.alibabacloud.com/help/en/model-studio/model-pricing"),
  suppliedVideo("supplied-pixverse-v56-first-last", "PixVerse V5.6 First/Last Frame", "1080P", 0.375, "pixverse-v5.6-shouweizhen", "https://docs.platform.pixverse.ai/pricing-796039m0"),
  suppliedVideo("supplied-pixverse-v56-r2v", "PixVerse V5.6 R2V", "1080P", 0.375, "pixverse-v5.6-r2v", "https://docs.platform.pixverse.ai/pricing-796039m0"),
  suppliedVideo("supplied-vidu-jieshuoman", "Vidu Jieshuoman", "1080P", 0.24, "vidu-jieshuoman", "https://platform.vidu.com/docs/pricing"),
  suppliedVideo("supplied-vidu-mv", "Vidu MV", "1080P", 0.24, "vidu-mv", "https://platform.vidu.com/docs/pricing"),
];

const SOURCES: SourceDefinition[] = [
  {
    sourceId: "google-gemini-pricing",
    label: "Google Gemini API",
    url: "https://ai.google.dev/gemini-api/docs/pricing",
    automatic: true,
    parse: parseGooglePrices,
  },
  {
    sourceId: "openai-images",
    label: "OpenAI API",
    url: "https://developers.openai.com/api/docs/guides/image-generation",
    automatic: false,
    parse: () => [],
  },
  {
    sourceId: "minimax-h3-pricing",
    label: "MiniMax Open Platform",
    url: "https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise",
    automatic: true,
    parse: parseMiniMaxPrices,
  },
  {
    sourceId: "replicate-kling-v26",
    label: "Replicate",
    url: "https://replicate.com/kwaivgi/kling-v2.6",
    automatic: true,
    parse: parseReplicatePrices,
  },
  {
    sourceId: "alibaba-wan-pricing",
    label: "Alibaba Cloud Model Studio",
    url: "https://docs.modelstudio.console.alibabacloud.com/en/model-studio/wan3-0-video",
    automatic: false,
    parse: () => [],
  },
  {
    sourceId: "fal-seedance-20-pricing",
    label: "ByteDance Seedance 2.0 / fal.ai API",
    url: "https://github.com/fal-ai/seedance-2.0-api",
    automatic: false,
    parse: () => [],
  },
];

type PriceRow = OfficialModelPrice & {
  official_min: number | string;
  official_max: number | string;
  helstera_credits: number | string;
  snapshot_date: string | Date;
  last_verified_at: string | Date | null;
};

type SourceRow = {
  source_id: string;
  status: OfficialPriceSourceStatus["status"];
  last_attempt_at: string | Date | null;
  last_success_at: string | Date | null;
  item_count: number;
};

export function getOfficialPriceSnapshots(): OfficialModelPrice[] {
  return SNAPSHOTS.map((price) => ({ ...price }));
}

export async function loadOfficialModelPriceCatalog(db: Pool): Promise<OfficialModelPriceCatalog> {
  await seedOfficialPriceSnapshots(db);
  const [prices, sources] = await Promise.all([
    db.query<PriceRow>(
      `select price_key as "priceKey",provider_key as "providerKey",provider_label as "providerLabel",
              model_id as "modelId",model_name as "modelName",media_type as "mediaType",variant,
              official_min,official_max,currency,billing_unit as unit,unit_label as "unitLabel",
              helstera_credits,helstera_unit_label as "helsteraUnitLabel",note,source_id as "sourceId",
              source_label as "sourceLabel",source_url as "sourceUrl",snapshot_date::text as snapshot_date,last_verified_at
         from official_model_prices
        order by media_type,provider_label,model_name,variant`,
    ),
    db.query<SourceRow>(
      `select source_id,status,last_attempt_at,item_count,last_success_at
         from official_model_price_sources`,
    ),
  ]);
  const sourceRows = new Map(sources.rows.map((row) => [row.source_id, row]));

  const allPrices = prices.rows.map((row) => ({
      ...row,
      officialMin: Number(row.official_min),
      officialMax: Number(row.official_max),
      helsteraCredits: Number(row.helstera_credits),
      snapshotDate: dateOnly(row.snapshot_date),
      lastVerifiedAt: isoDate(row.last_verified_at),
    })).filter(isPublicOfficialPrice).filter((price) => price.unit !== "per_million_tokens");
  return {
    prices: allPrices,
    usdCnyRate: USD_CNY_RATE,
    sources: SOURCES.map((source) => {
      const row = sourceRows.get(source.sourceId);
      return {
        sourceId: source.sourceId,
        label: source.label,
        url: source.url,
        automatic: source.automatic,
        status: row?.status ?? (source.automatic ? "pending" : "snapshot"),
        lastAttemptAt: isoDate(row?.last_attempt_at ?? null),
        lastSuccessAt: isoDate(row?.last_success_at ?? null),
        itemCount: row?.item_count ?? 0,
      };
    }),
  };
}

export function isPublicOfficialPrice(price: OfficialModelPrice): boolean {
  return !isRemovedImageModelId(price.modelId)
    && !/nano\s*banana/i.test(price.modelName);
}

export async function seedOfficialPriceSnapshots(db: Pool): Promise<void> {
  if (SEED_POOLS.has(db)) return;

  for (const price of SNAPSHOTS) {
    await db.query(
      `insert into official_model_prices (
         price_key,provider_key,provider_label,model_id,model_name,media_type,variant,
         official_min,official_max,currency,billing_unit,unit_label,helstera_credits,
         helstera_unit_label,note,source_id,source_label,source_url,snapshot_date,last_verified_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       on conflict (price_key) do update set
         provider_label=excluded.provider_label,model_name=excluded.model_name,variant=excluded.variant,
         unit_label=excluded.unit_label,helstera_unit_label=excluded.helstera_unit_label,
         note=excluded.note,source_label=excluded.source_label,source_url=excluded.source_url,
         snapshot_date=excluded.snapshot_date,updated_at=now()`,
      [
        price.priceKey, price.providerKey, price.providerLabel, price.modelId, price.modelName,
        price.mediaType, price.variant, price.officialMin, price.officialMax, price.currency,
        price.unit, price.unitLabel, price.helsteraCredits, price.helsteraUnitLabel, price.note,
        price.sourceId, price.sourceLabel, price.sourceUrl, price.snapshotDate, price.lastVerifiedAt,
      ],
    );
  }
  for (const source of SOURCES) {
    await db.query(
      `insert into official_model_price_sources (source_id,label,source_url,automatic,status)
       values ($1,$2,$3,$4,$5)
       on conflict (source_id) do nothing`,
      [source.sourceId, source.label, source.url, source.automatic, source.automatic ? "pending" : "snapshot"],
    );
  }
  SEED_POOLS.add(db);
}

export async function syncOfficialModelPrices(
  db: Pool,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<{ succeeded: number; failed: number; updatedPrices: number }> {
  await seedOfficialPriceSnapshots(db);
  const results = await Promise.all(SOURCES.filter((source) => source.automatic).map(async (source) => {
    const attemptedAt = now().toISOString();
    try {
      const response = await fetchOfficialSource(source, fetcher);
      if (!response.ok) throw new Error(`official source returned HTTP ${response.status}`);
      const html = await response.text();
      if (html.length > MAX_SOURCE_BYTES) throw new Error("official price source exceeded the size limit");
      const prices = source.parse(html, attemptedAt);
      if (!prices.length) throw new Error("official source format changed; no known prices were parsed");

      for (const price of prices) await saveVerifiedPrice(db, price);
      await saveSourceStatus(db, source, "success", attemptedAt, attemptedAt, prices.length, null);
      return { ok: true, count: prices.length };
    } catch (error) {
      const message = safeErrorMessage(error);
      await saveSourceStatus(db, source, "failed", attemptedAt, null, 0, message);
      return { ok: false, count: 0 };
    }
  }));

  return {
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    updatedPrices: results.reduce((sum, result) => sum + result.count, 0),
  };
}

async function fetchOfficialSource(source: SourceDefinition, fetcher: typeof fetch): Promise<Response> {
  const headers = { "user-agent": "HelsteraOfficialPriceSync/1.0", accept: "text/html" };
  const first = await fetcher(source.url, {
    headers,
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    redirect: "manual",
  });
  if (first.status < 300 || first.status >= 400) return first;

  const location = first.headers.get("location");
  if (!location) throw new Error("official source redirect had no location");
  const destination = new URL(location, source.url);
  if (destination.hostname !== new URL(source.url).hostname) {
    throw new Error("official source redirected outside its allowlisted host");
  }
  return fetcher(destination, {
    headers,
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    redirect: "error",
  });
}

export function parseGooglePrices(html: string, checkedAt: string): OfficialModelPrice[] {
  const text = load(html)("body").text().replace(/\s+/g, " ");
  const flash = nearestSection(text, "Gemini 3.1 Flash Image", "Gemini 3.1 Flash Lite Image");
  const flashMatch = flash.match(/Equivalent to \$([\d.]+) per 0\.5K image.*?\$([\d.]+) per 1K image.*?\$([\d.]+) per 2K image.*?\$([\d.]+) per 4K image/i);
  const pro = nearestSection(text, "Gemini 3 Pro Image", "Gemini 3.1 Flash Image");
  const proMatch = pro.match(/Equivalent to \$([\d.]+) per 1K\/2K image.*?\$([\d.]+) per 4K image/i);
  const veo = nearestSection(text, "Veo 3.1", "Lyria");
  const veoStandard = veo.match(/Veo 3\.1 Standard video with audio price[^$]*\$([\d.]+) \(720p and 1080p\)[^$]*\$([\d.]+) \(4k\)/i);
  if (!flashMatch || !proMatch || !veoStandard) throw new Error("Google pricing sections were not recognized");

  return [
    verified("google-flash-image-1k", Number(flashMatch[2]), checkedAt),
    verified("google-flash-image-2k", Number(flashMatch[3]), checkedAt),
    verified("google-flash-image-4k", Number(flashMatch[4]), checkedAt),
    verified("google-pro-image-1k", Number(proMatch[1]), checkedAt),
    verified("google-pro-image-4k", Number(proMatch[2]), checkedAt),
    verified("google-veo-31-720p", Number(veoStandard[1]), checkedAt),
    verified("google-veo-31-4k", Number(veoStandard[2]), checkedAt),
  ];
}

export function parseMiniMaxPrices(html: string, checkedAt: string): OfficialModelPrice[] {
  const $ = load(html);
  const rates = new Map<string, number>();
  $("table tr").each((_, row) => {
    const cells = $(row).find("th,td").map((__, cell) => $(cell).text().trim()).get();
    if (cells[0] !== "MiniMax-H3" || !["768P", "2K"].includes(cells[1] ?? "")) return;
    if (!/billed per second/i.test(cells[2] ?? "")) return;
    const amount = cells[3]?.match(/\$([\d.]+)\s*\/\s*second/i)?.[1];
    if (amount) rates.set(cells[1]!, Number(amount));
  });

  const p768 = rates.get("768P");
  const p2k = rates.get("2K");
  if (p768 === undefined || p2k === undefined) throw new Error("MiniMax H3 pricing rows were not recognized");
  return [
    verified("minimax-h3-768p", p768, checkedAt),
    verified("minimax-h3-2k", p2k, checkedAt),
  ];
}

export function parseReplicatePrices(html: string, checkedAt: string): OfficialModelPrice[] {
  const $ = load(html);
  let model: Record<string, unknown> | undefined;
  for (const script of $("script[type='application/json']").toArray()) {
    try {
      const payload = JSON.parse($(script).html() ?? "null") as Record<string, unknown>;
      if (payload.modelName === "kwaivgi/kling-v2.6") {
        model = payload;
        break;
      }
    } catch {
      // Other JSON scripts on the model page are unrelated to billing.
    }
  }
  const billing = model?.billingConfig as { current_tiers?: Array<{ prices?: Array<{ price?: string }> }> } | undefined;
  const amounts = (billing?.current_tiers ?? [])
    .map((tier) => Number(tier.prices?.[0]?.price?.replace("$", "")))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (amounts.length < 2) throw new Error("Replicate Kling billing tiers were not recognized");
  return [verifiedRange("replicate-kling-v26-standard-pro", amounts[0]!, amounts.at(-1)!, checkedAt)];
}

function nearestSection(text: string, heading: string, nextHeading: string): string {
  const start = text.lastIndexOf(heading);
  if (start < 0) return "";
  const next = text.indexOf(nextHeading, start + heading.length);
  return text.slice(start, next < 0 ? start + 8_000 : next);
}

function verified(priceKey: string, amount: number, checkedAt: string): OfficialModelPrice {
  const seed = SNAPSHOTS.find((row) => row.priceKey === priceKey);
  if (!seed) throw new Error(`No public price mapping exists for ${priceKey}`);
  return { ...seed, officialMin: amount, officialMax: amount, lastVerifiedAt: checkedAt };
}

function verifiedRange(priceKey: string, min: number, max: number, checkedAt: string): OfficialModelPrice {
  const seed = SNAPSHOTS.find((row) => row.priceKey === priceKey);
  if (!seed) throw new Error(`No public price mapping exists for ${priceKey}`);
  return { ...seed, officialMin: min, officialMax: max, lastVerifiedAt: checkedAt };
}

async function saveVerifiedPrice(db: Pool, price: OfficialModelPrice): Promise<void> {
  await db.query(
    `update official_model_prices set official_min=$2,official_max=$3,last_verified_at=$4,updated_at=now()
      where price_key=$1`,
    [price.priceKey, price.officialMin, price.officialMax, price.lastVerifiedAt],
  );
}

async function saveSourceStatus(
  db: Pool,
  source: SourceDefinition,
  status: "success" | "failed",
  attemptedAt: string,
  successfulAt: string | null,
  itemCount: number,
  error: string | null,
): Promise<void> {
  await db.query(
    `update official_model_price_sources
        set status=$2,last_attempt_at=$3,last_success_at=coalesce($4,last_success_at),
            item_count=case when $2='success' then $5 else item_count end,last_error=$6
      where source_id=$1`,
    [source.sourceId, status, attemptedAt, successfulAt, itemCount, error],
  );
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "official source request failed";
  return error.message.slice(0, 240);
}

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function isoDate(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function googleImage(priceKey: string, modelName: string, variant: string, price: number, modelId: string, credits: number): OfficialModelPrice {
  return {
    priceKey, providerKey: "google", providerLabel: "Google Gemini API", modelId, modelName,
    mediaType: "image", variant, officialMin: price, officialMax: price, currency: "USD",
    unit: "per_image", unitLabel: "per image", helsteraCredits: credits,
    helsteraUnitLabel: "per image", note: "官方图像输出费；文字和参考图输入可能另计。",
    sourceId: "google-gemini-pricing", sourceLabel: "Google Gemini API 官方价格",
    sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing", snapshotDate: SNAPSHOT_DATE, lastVerifiedAt: null,
  };
}

function googleVideo(priceKey: string, modelName: string, variant: string, price: number, modelId: string, credits: number): OfficialModelPrice {
  return {
    priceKey, providerKey: "google", providerLabel: "Google Gemini API", modelId, modelName,
    mediaType: "video", variant, officialMin: price, officialMax: price, currency: "USD",
    unit: "per_second", unitLabel: "per second", helsteraCredits: credits,
    helsteraUnitLabel: "per 5 seconds", note: "官方按输出视频秒数计费；Helstera credits 为 5 秒基准。",
    sourceId: "google-gemini-pricing", sourceLabel: "Google Gemini API 官方价格",
    sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing", snapshotDate: SNAPSHOT_DATE, lastVerifiedAt: null,
  };
}

function minimaxVideo(priceKey: string, variant: string, price: number): OfficialModelPrice {
  return {
    priceKey, providerKey: "metaso", providerLabel: "Metaso / MiniMax", modelId: "metaso/MiniMax-H3",
    modelName: "MiniMax H3", mediaType: "video", variant, officialMin: price, officialMax: price,
    currency: "USD", unit: "per_second", unitLabel: "per second", helsteraCredits: 60,
    helsteraUnitLabel: "per 5 seconds", note: "官方直连 API 标价；Helstera 通过 Metaso 路由，实际供应成本可能不同。",
    sourceId: "minimax-h3-pricing", sourceLabel: "MiniMax Open Platform 官方价格",
    sourceUrl: "https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise",
    snapshotDate: SNAPSHOT_DATE, lastVerifiedAt: null,
  };
}

function wanVideo(priceKey: string, modelName: string, variant: string, price: number, modelId: string): OfficialModelPrice {
  return {
    priceKey, providerKey: "alibaba", providerLabel: "Alibaba Cloud Model Studio", modelId, modelName,
    mediaType: "video", variant, officialMin: price, officialMax: price, currency: "USD",
    unit: "per_second", unitLabel: "per second", helsteraCredits: 0, helsteraUnitLabel: "runtime price",
    note: "官方 Alibaba Cloud Model Studio 原价，按 1080P 输出视频秒数计费；Helstera 使用工作区实际配置价。",
    sourceId: "alibaba-wan-pricing", sourceLabel: "Alibaba Cloud Model Studio 官方价格",
    sourceUrl: "https://docs.modelstudio.console.alibabacloud.com/en/model-studio/wan3-0-video",
    snapshotDate: SNAPSHOT_DATE, lastVerifiedAt: null,
  };
}

function seedanceVideo(priceKey: string, modelId: string): OfficialModelPrice {
  return {
    priceKey, providerKey: "fal-seedance", providerLabel: "ByteDance Seedance 2.0 / fal.ai API", modelId,
    modelName: modelId, mediaType: "video", variant: "Standard · 720P", officialMin: 0.3034, officialMax: 0.3034,
    currency: "USD", unit: "per_second", unitLabel: "per second", helsteraCredits: 0,
    helsteraUnitLabel: "runtime price", note: "公开 API 参考价，来自 ByteDance Seedance 2.0 的授权 fal.ai API 文档，不代表 ByteDance 直连价格。",
    sourceId: "fal-seedance-20-pricing", sourceLabel: "ByteDance Seedance 2.0 / fal.ai API 公开价格",
    sourceUrl: "https://github.com/fal-ai/seedance-2.0-api", snapshotDate: SNAPSHOT_DATE, lastVerifiedAt: null,
  };
}

function publicVideo(
  priceKey: string,
  modelName: string,
  variant: string,
  price: number,
  modelId: string,
  sourceUrl: string,
  note = "公开价格来源的最高可核验档位",
): OfficialModelPrice {
  return {
    priceKey, providerKey: "public-reference", providerLabel: "公开价格参考", modelId, modelName,
    mediaType: "video", variant, officialMin: price, officialMax: price, currency: "USD",
    unit: "per_second", unitLabel: "per second", helsteraCredits: 0, helsteraUnitLabel: "runtime price",
    note, sourceId: priceKey, sourceLabel: "联网公开价格参考", sourceUrl,
    snapshotDate: SNAPSHOT_DATE, lastVerifiedAt: null,
  };
}

function suppliedVideo(
  priceKey: string,
  modelName: string,
  variant: string,
  price: number,
  modelId: string,
  sourceUrl: string,
): OfficialModelPrice {
  return {
    priceKey,
    providerKey: "user-supplied-official-snapshot",
    providerLabel: "用户提供的官方价格快照",
    modelId,
    modelName,
    mediaType: "video",
    variant,
    officialMin: price,
    officialMax: price,
    currency: "USD",
    unit: "per_second",
    unitLabel: "per second",
    helsteraCredits: 0,
    helsteraUnitLabel: "runtime price",
    note: "价格来自用户提供的官方 API 价格整理；请以对应平台当前页面为准。",
    sourceId: priceKey,
    sourceLabel: "用户提供的官方价格快照",
    sourceUrl,
    snapshotDate: SNAPSHOT_DATE,
    lastVerifiedAt: null,
  };
}

function tokenPrice(
  priceKey: string,
  modelName: string,
  variant: string,
  price: number,
  modelId: string,
  sourceUrl: string,
  note: string,
  mediaType: "image" | "video" = "image",
): OfficialModelPrice {
  return {
    priceKey, providerKey: "public-reference", providerLabel: "官方 API", modelId, modelName,
    mediaType, variant, officialMin: price, officialMax: price, currency: "USD",
    unit: "per_million_tokens", unitLabel: "per million tokens", helsteraCredits: 0,
    helsteraUnitLabel: "token billing", note, sourceId: priceKey,
    sourceLabel: "官方 API Token 定价", sourceUrl, snapshotDate: SNAPSHOT_DATE, lastVerifiedAt: null,
  };
}

function openaiImageEstimate(
  priceKey: string,
  modelName: string,
  variant: string,
  modelId: string,
  officialMin: number,
  officialMax: number,
): OfficialModelPrice {
  return {
    priceKey,
    providerKey: "openai",
    providerLabel: "OpenAI API Token 折算估算",
    modelId,
    modelName,
    mediaType: "image",
    variant,
    officialMin,
    officialMax,
    currency: "USD",
    unit: "per_image",
    unitLabel: "estimated per image",
    helsteraCredits: 0,
    helsteraUnitLabel: "runtime price",
    note: "按 OpenAI 官方 GPT Image 2 Token 单价和像素面积估算；OpenAI 不提供固定按张价格，实际以响应 Token 用量为准。",
    sourceId: priceKey,
    sourceLabel: "OpenAI 官方 Token 价格折算",
    sourceUrl: "https://platform.openai.com/pricing",
    snapshotDate: SNAPSHOT_DATE,
    lastVerifiedAt: null,
  };
}

function minimaxAlias(
  priceKey: string,
  modelName: string,
  variant: string,
  price: number,
  modelId: string,
): OfficialModelPrice {
  const source = minimaxVideo(priceKey, variant, price);
  return {
    ...source,
    priceKey,
    modelName,
    modelId,
    variant,
    officialMin: price,
    officialMax: price,
    note: "Hailuo H3 is published under MiniMax H3 in the provider API price list; 2K output is $0.13 per second.",
  };
}
