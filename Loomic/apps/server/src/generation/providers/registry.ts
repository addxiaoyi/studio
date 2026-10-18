import type {
  ImageProvider,
  ModelInfo,
  VideoModelInfo,
  VideoProvider,
} from "../types.js";
import { GenerationError } from "../utils.js";
import { isRemovedImageModelId, isRemovedModelId } from "../removed-models.js";
import { getConfiguredBilling, getImageCreditCost, isNanoImageModelId, isWithinPublicUnitPriceLimit } from "@helstera/shared";

const imageProviders = new Map<string, ImageProvider>();
const videoProviders = new Map<string, VideoProvider>();

export function registerImageProvider(provider: ImageProvider): void {
  imageProviders.set(provider.name, provider);
}

export function registerVideoProvider(provider: VideoProvider): void {
  videoProviders.set(provider.name, provider);
}

export function getImageProvider(name: string): ImageProvider {
  const provider = imageProviders.get(name);
  if (!provider) {
    throw new GenerationError(
      name,
      "provider_not_found",
      `No image provider registered: ${name}`,
    );
  }
  return provider;
}

export function getVideoProvider(name: string): VideoProvider {
  const provider = videoProviders.get(name);
  if (!provider) {
    throw new GenerationError(
      name,
      "provider_not_found",
      `No video provider registered: ${name}`,
    );
  }
  return provider;
}

/** Model info enriched with its owning provider name. */
export interface AvailableModel extends ModelInfo {
  provider: string;
}

export interface AvailableVideoModel extends VideoModelInfo {
  provider: string;
}

function isWithinConfiguredPrice(modelId: string, mediaType: "image" | "video"): boolean {
  const billing = getConfiguredBilling(modelId);
  if (billing) {
    if (mediaType === "video" && billing.billingUnit === "per_million_tokens") return false;
    return billing.billingUnit === "per_million_tokens" || isWithinPublicUnitPriceLimit(billing.billingUnit, billing.creditCost);
  }
  try {
    return isWithinPublicUnitPriceLimit("per_generation", getImageCreditCost(modelId, "hd"));
  } catch {
    return true;
  }
}

/** Returns all image models from all registered providers. */
export function getAvailableImageModels(): AvailableModel[] {
  return [...imageProviders.values()].flatMap((p) =>
    p.models
      .filter((m) => {
        const id = m.id.toLowerCase();
        return !isNanoImageModelId(id)
          && !m.displayName.toLowerCase().includes("nano banana")
          && !isRemovedImageModelId(id)
          && !id.includes("4k-超分");
      })
      .filter((m) => isWithinConfiguredPrice(m.id, "image"))
      .map((m) => ({ ...m, provider: p.name })),
  );
}

/** Returns all video models from all registered providers. */
export function getAvailableVideoModels(): AvailableVideoModel[] {
  return [...videoProviders.values()].flatMap((p) =>
    p.models.filter((m) => !isRemovedModelId(m.id) && isWithinConfiguredPrice(m.id, "video")).map((m) => ({ ...m, provider: p.name })),
  );
}

/** Resolves the provider name that handles a given image model ID. */
export function resolveImageProviderName(modelId: string): string {
  if (isRemovedImageModelId(modelId)) {
    throw new GenerationError("disabled", "model_not_found", `Retired image model: ${modelId}`);
  }
  for (const provider of imageProviders.values()) {
    if (provider.models.some((m) => m.id === modelId)) {
      return provider.name;
    }
  }
  throw new GenerationError(
    "unknown",
    "model_not_found",
    `No provider registered for image model: ${modelId}`,
  );
}

/** Resolves the provider name that handles a given video model ID. */
export function resolveVideoProviderName(modelId: string): string {
  if (isRemovedModelId(modelId) || !isWithinConfiguredPrice(modelId, "video")) {
    throw new GenerationError("disabled", "model_not_found", `Retired video model: ${modelId}`);
  }
  for (const provider of videoProviders.values()) {
    if (provider.models.some((m) => m.id === modelId)) {
      return provider.name;
    }
  }
  throw new GenerationError(
    "unknown",
    "model_not_found",
    `No provider registered for video model: ${modelId}`,
  );
}

export function clearProviders(): void {
  imageProviders.clear();
  videoProviders.clear();
}
