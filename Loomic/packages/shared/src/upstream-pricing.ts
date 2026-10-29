import type { VideoResolution } from "./credits.js";

export type UpstreamBillingUnit = "per_second" | "per_generation" | "per_million_tokens";

export type UpstreamCost = {
  unit: UpstreamBillingUnit;
  costCny: number;
  resolutionCostsCny?: Partial<Record<VideoResolution, number>>;
};

export type ConfiguredVideoPriceRate = {
  resolution: VideoResolution;
  priceCnyPerSecond: number;
};

// Upstream public price snapshot. Values are already expressed in CNY per
// billing unit and must not receive a second platform-margin multiplier.
export const UPSTREAM_COSTS: Readonly<Record<string, UpstreamCost>> = {
  "doubao-seedance-2-5-260628": {"unit":"per_million_tokens","costCny":48.384},
  "doubao-seedance-2-5-cankaosheng": {"unit":"per_million_tokens","costCny":48.384},
  "doubao-seedance-2-5-quannengcankao": {"unit":"per_million_tokens","costCny":48.384},
  "doubao-seedance-2-5-shouweizhen": {"unit":"per_million_tokens","costCny":48.384},
  "gk-video-3": {"unit":"per_generation","costCny":0.576},
  "gk-video-3.5": {"unit":"per_second","costCny":0.1135},
  "hailuo-h3": {"unit":"per_second","costCny":0.0864},
  "hailuo-h3-cankaosheng": {"unit":"per_second","costCny":0.0864},
  "hailuo-h3-max": {"unit":"per_second","costCny":0.4752},
  "hailuo-h3-max-shouweizhen": {"unit":"per_second","costCny":0.4752},
  "hailuo-h3-quannengcankao": {"unit":"per_second","costCny":0.0864},
  "hailuo-h3-shouweizhen": {"unit":"per_second","costCny":0.0864},
  "hailuo-h3-zaishengcheng": {"unit":"per_second","costCny":0.095},
  "happyhorse-1.1-i2v": {"unit":"per_second","costCny":0.72},
  "happyhorse-1.1-r2v": {"unit":"per_second","costCny":0.72},
  "happyhorse-1.1-t2v": {"unit":"per_second","costCny":0.72},
  "happyhorse-i2v": {"unit":"per_second","costCny":0.7517},
  "happyhorse-r2v": {"unit":"per_second","costCny":0.7517},
  "happyhorse-t2v": {"unit":"per_second","costCny":0.7517},
  "happyhorse-video-edit": {"unit":"per_second","costCny":0.7517},
  "kling-avatar-image2video": {"unit":"per_second","costCny":0.432},
  "kling-motion-control": {"unit":"per_second","costCny":0.576},
  "kling-motion-control-v3": {"unit":"per_second","costCny":0.6466},
  "kling-v3-omni-cankao": {"unit":"per_generation","costCny":2.8786},
  "kling-v3-omni-shouweizhen": {"unit":"per_generation","costCny":2.8786},
  "kling-v3-omni-videoref": {"unit":"per_second","costCny":0.6466},
  "kling-v3-video": {"unit":"per_generation","costCny":3.2386},
  "kwvideo-v2": {"unit":"per_million_tokens","costCny":29.304},
  "kwvideo-v2-quannengcankao": {"unit":"per_million_tokens","costCny":31.68},
  "kwvideo-v2-ref": {"unit":"per_million_tokens","costCny":29.304},
  "minimax-h3": {
    "unit":"per_second",
    "costCny":0.095,
    "resolutionCostsCny":{"480p":0.055,"768p":0.075,"1088p":0.085,"1440p":0.095},
  },
  "minimax-h3-max": {"unit":"per_second","costCny":0.4752},
  "omni_flash-10s": {"unit":"per_generation","costCny":0.7344},
  "omni_flash-10s-fl": {"unit":"per_generation","costCny":0.7344},
  "omni-1.1": {"unit":"per_generation","costCny":0.2592},
  "omni-flash": {"unit":"per_generation","costCny":0.3456},
  "pixverse-c1-cankaosheng": {"unit":"per_generation","costCny":0.6576},
  "pixverse-c1-shouweizhen": {"unit":"per_generation","costCny":0.6576},
  "pixverse-v5.6-r2v": {"unit":"per_second","costCny":0.5414},
  "pixverse-v5.6-shouweizhen": {"unit":"per_second","costCny":0.5414},
  "pixverse-v6-shouweizhen": {"unit":"per_second","costCny":0.192},
  "seedance-2.0-anmiao": {"unit":"per_second","costCny":0.175},
  "seedance-2.0-anmiao-cankaosheng": {"unit":"per_second","costCny":0.175},
  "seedance-2.0-anmiao-quannengcankao": {"unit":"per_second","costCny":0.1728},
  "seedance-2.0-guanfang": {"unit":"per_million_tokens","costCny":31.68},
  "seedance-2.0-guanfang-anmiao": {"unit":"per_second","costCny":0.144},
  "seedance-2.5-anmiao": {"unit":"per_second","costCny":0.4896},
  "seedance-2.5-anmiao-quannengcankao": {"unit":"per_second","costCny":0.4896},
  "seedance-2.5-anmiao-shouweizhen": {"unit":"per_second","costCny":0.4896},
  "seedance-2.5-anmiao-wensheng": {"unit":"per_second","costCny":0.4896},
  "seedance-2.5-guanfang": {"unit":"per_million_tokens","costCny":48.384},
  "video-enhance": {"unit":"per_second","costCny":0.0199},
  "vidu-jieshuoman": {"unit":"per_second","costCny":0.4951},
  "vidu-mv": {"unit":"per_second","costCny":0.1488},
  "viduq2-cankaosheng": {"unit":"per_generation","costCny":0.8669},
  "viduq3": {"unit":"per_generation","costCny":0.2873},
  "viduq3-cankaosheng": {"unit":"per_generation","costCny":0.4954},
  "viduq3-drama": {"unit":"per_second","costCny":0.6931},
  "viduq3-turbo": {"unit":"per_second","costCny":0.0864},
  "viduq3-turbo-cankaosheng": {"unit":"per_second","costCny":0.0864},
  "viduq4-preview": {"unit":"per_second","costCny":0.2016},
  "vo3.1": {"unit":"per_generation","costCny":0.36},
  "wan2.2-animate-mix": {"unit":"per_second","costCny":0.3024},
  "wan2.6-cankaosheng": {"unit":"per_generation","costCny":0.3931},
  "wan2.6-shouzheng": {"unit":"per_generation","costCny":0.4536},
  "wan2.7-cankaosheng": {"unit":"per_generation","costCny":1.296},
  "wan2.7-shouweizhen": {"unit":"per_generation","costCny":1.296},
  "wan2.7-xuxie": {"unit":"per_generation","costCny":1.296},
  "wan3.0": {"unit":"per_second","costCny":0.432},
  "wan3.0-video": {"unit":"per_second","costCny":0.432},
  "wan3.0-video-cankaosheng": {"unit":"per_second","costCny":0.432},
  "wan3.0-video-quannengcankao": {"unit":"per_second","costCny":0.432},
  "wan3.0-video-shouweizhen": {"unit":"per_second","costCny":0.432},
}
export function getUpstreamCost(modelId: string): UpstreamCost | null {
  return UPSTREAM_COSTS[modelId.trim().toLowerCase()] ?? null;
}

export function getUpstreamSellPrice(modelId: string, resolution?: VideoResolution): number | null {
  const cost = getUpstreamCost(modelId);
  if (!cost) return null;
  const selected = resolveVideoResolution(modelId, resolution);
  const resolutionCost = selected ? cost.resolutionCostsCny?.[selected] : undefined;
  return Number(((resolutionCost ?? cost.costCny) / 0.25).toFixed(4));
}

export function resolveVideoResolution(modelId: string, requested?: VideoResolution): VideoResolution | undefined {
  const rates = getUpstreamCost(modelId)?.resolutionCostsCny;
  if (!rates) return requested;
  const resolution = requested === "720p" ? "768p" : requested === "1080p" ? "1088p" : requested ?? "768p";
  if (rates[resolution] === undefined) {
    throw Object.assign(new Error(`Unsupported resolution for ${modelId}: ${resolution}`), { code: "invalid_input", statusCode: 422 });
  }
  return resolution;
}

export function getConfiguredVideoPriceRates(modelId: string): ConfiguredVideoPriceRate[] {
  const rates = getUpstreamCost(modelId)?.resolutionCostsCny;
  if (!rates) return [];
  return Object.entries(rates).flatMap(([resolution, costCny]) => {
    if (costCny == null || !Number.isFinite(costCny) || costCny <= 0) return [];
    return [{
      resolution: resolution as VideoResolution,
      priceCnyPerSecond: Number((costCny / 0.25).toFixed(4)),
    }];
  });
}
