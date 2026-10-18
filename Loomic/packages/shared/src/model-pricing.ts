export type OfficialPriceUnit = "per_image" | "per_second" | "per_million_tokens";
export type OfficialPriceMediaType = "image" | "video";

export const MAX_PUBLIC_UNIT_PRICE_CNY = 3;

export function isWithinPublicUnitPriceLimit(unit: string, priceCny: number): boolean {
  return unit === "per_million_tokens" || (Number.isFinite(priceCny) && priceCny <= MAX_PUBLIC_UNIT_PRICE_CNY);
}

const NANO_IMAGE_MODEL_IDS = new Set([
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
]);

export function isNanoImageModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  const shortId = normalized.split(/[/:]/).filter(Boolean).at(-1) ?? normalized;
  return normalized.includes("nano-banana") || NANO_IMAGE_MODEL_IDS.has(shortId);
}

export type OfficialModelPrice = {
  priceKey: string;
  providerKey: string;
  providerLabel: string;
  modelId: string;
  modelName: string;
  mediaType: OfficialPriceMediaType;
  variant: string;
  officialMin: number;
  officialMax: number;
  currency: "USD";
  unit: OfficialPriceUnit;
  unitLabel: string;
  helsteraCredits: number;
  helsteraUnitLabel: string;
  note: string | null;
  sourceId: string;
  sourceLabel: string;
  sourceUrl: string;
  snapshotDate: string;
  lastVerifiedAt: string | null;
};

export type OfficialPriceSourceStatus = {
  sourceId: string;
  label: string;
  url: string;
  automatic: boolean;
  status: "pending" | "success" | "failed" | "snapshot";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  itemCount: number;
};

export type OfficialModelPriceCatalog = {
  prices: OfficialModelPrice[];
  sources: OfficialPriceSourceStatus[];
  usdCnyRate: number;
};

export type WorkspaceModelPrice = {
  modelId: string;
  displayName: string;
  providerLabel: string;
  mediaType: OfficialPriceMediaType;
  billingUnit: "per_generation" | "per_second" | "per_million_tokens";
  priceCny: number | null;
  inputPriceCny: number | null;
  outputPriceCny: number | null;
  modelEnabled: boolean;
  providerEnabled: boolean;
  modelHealth: string;
  providerHealth: string;
};

export type OfficialPriceComparison = {
  officialMaxCny: number;
  deltaCny: number;
  relation: "below" | "equal" | "above";
  unit: OfficialPriceUnit;
};

export function compareHelsteraWithOfficialMax(
  price: OfficialModelPrice,
  usdCnyRate: number,
): OfficialPriceComparison {
  if (price.unit === "per_million_tokens") {
    throw new Error("Token prices cannot be compared with fixed per-image or per-second charges");
  }
  const helsteraUnitCount = price.unit === "per_second" ? 5 : 1;
  const officialMaxCny = price.officialMax * usdCnyRate;
  const helsteraUnitPrice = price.helsteraCredits / helsteraUnitCount;
  const deltaCny = helsteraUnitPrice - officialMaxCny;
  const relation = deltaCny > 0.005 ? "above" : deltaCny < -0.005 ? "below" : "equal";

  return { officialMaxCny, deltaCny, relation, unit: price.unit };
}

export function getHelsteraPricePerUnit(price: OfficialModelPrice): number {
  if (price.unit === "per_million_tokens") {
    throw new Error("Token prices do not have a fixed per-image or per-second unit");
  }
  return price.helsteraCredits / (price.unit === "per_second" ? 5 : 1);
}
