import type { ImageQualityLevel } from "./credits.js";

export const KUAIPAO_IMAGE_MODELS = [
  "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.6-flare",
  "gpt-image-2.5-sunburst", "gpt-image-2.6-sunburst",
] as const;
export const KUAIPAO_IMAGE_COSTS = { "1K": 0.05, "2K": 0.08, "4K": 0.30 } as const;
export const KUAIPAO_IMAGE_MARGIN = 0.75;
export type KuaipaoImageResolution = keyof typeof KUAIPAO_IMAGE_COSTS;

export function isKuaipaoImageModel(model: string): boolean {
  return (KUAIPAO_IMAGE_MODELS as readonly string[]).includes(model);
}

export function kuaipaoImageResolution(quality: ImageQualityLevel = "standard"): KuaipaoImageResolution {
  return quality === "ultra" ? "4K" : quality === "hd" ? "2K" : "1K";
}

export function getKuaipaoImagePrice(model: string, quality: ImageQualityLevel = "standard"): number | null {
  if (!isKuaipaoImageModel(model)) return null;
  return Number((KUAIPAO_IMAGE_COSTS[kuaipaoImageResolution(quality)] / (1 - KUAIPAO_IMAGE_MARGIN)).toFixed(4));
}

export function getKuaipaoImageRates(model: string) {
  if (!isKuaipaoImageModel(model)) return [];
  return (["standard", "hd", "ultra"] as const).map((quality) => ({
    quality, resolution: kuaipaoImageResolution(quality), priceCredits: getKuaipaoImagePrice(model, quality)!,
  }));
}
