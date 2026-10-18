type ModelPricing = {
  billingUnit?: "per_generation" | "per_second" | "per_million_tokens";
  creditCost?: number;
  providerPriceCny?: number;
  providerInputTokenPriceCny?: number;
  providerOutputTokenPriceCny?: number;
};

export type RuntimePriceModel = {
  id: string;
  displayName: string;
  mediaType: "image" | "video";
  billingUnit?: "per_generation" | "per_second" | "per_million_tokens";
  priceCny?: number;
};

export type RuntimePriceComparison = {
  priceCny: number;
  deltaCny: number;
  officialMaxCny: number;
  relation: "below" | "equal" | "above";
};

export function findRuntimePriceModel(
  officialModelId: string,
  mediaType: "image" | "video",
  models: RuntimePriceModel[],
): RuntimePriceModel | null {
  const officialId = normalizeId(officialModelId.split("/").at(-1) ?? officialModelId);
  const matches = models.filter((model) => {
    if (model.mediaType !== mediaType) return false;
    const modelId = normalizeId(model.id);
    return modelId === officialId;
  });
  return matches.length === 1 ? matches[0] ?? null : null;
}

export function compareRuntimePrice(priceCny: number, officialMaxCny: number): RuntimePriceComparison {
  const deltaCny = priceCny - officialMaxCny;
  const relation = deltaCny > 0.005 ? "above" : deltaCny < -0.005 ? "below" : "equal";
  return { priceCny, deltaCny, officialMaxCny, relation };
}

function normalizeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function yuan(value: number) {
  return `¥${value.toFixed(2)}`;
}

export function getModelPricingLabel(model: ModelPricing, mediaType: "image" | "video") {
  if (model.billingUnit === "per_million_tokens") {
    const input = model.providerInputTokenPriceCny;
    const output = model.providerOutputTokenPriceCny;
    if (typeof input === "number" && typeof output === "number") {
      return `输入 ${yuan(input)} / 1M Token · 输出 ${yuan(output)} / 1M Token`;
    }
    return "按 Token 计费";
  }
  const price = model.providerPriceCny ?? model.creditCost;
  if (typeof price !== "number") return "价格待配置";
  if (model.billingUnit === "per_second") return `${yuan(price)} / 秒 · 最终售价`;
  if (mediaType === "video") return "未上架 · 视频须按元/秒定价";
  return `${yuan(price)} / 张 · 最终售价`;
}
