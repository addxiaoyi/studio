import { generationPricingSchema, getConfiguredBilling, type GenerationPricing } from "@helstera/shared";

export function snapshotCatalogPricing(model: string, payload: Record<string, unknown>, quotedCredits: number): GenerationPricing | null {
  const configured = getConfiguredBilling(model);
  if (!configured) return null;
  if (configured.billingUnit === "per_million_tokens") return generationPricingSchema.parse(configured);
  if (configured.billingUnit === "per_generation") {
    return generationPricingSchema.parse({ billingUnit: "per_generation", creditCost: quotedCredits });
  }
  const seconds = payload.duration;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  // The displayed quote includes resolution-specific pricing; preserve that exact rate.
  return generationPricingSchema.parse({ billingUnit: "per_second", creditCost: quotedCredits / seconds });
}
