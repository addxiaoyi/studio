import type { GeneratedImage, ImageGenerateParams } from "./types.js";
import { getImageProvider } from "./providers/registry.js";
import { isRemovedImageModelId } from "./removed-models.js";
import { GenerationError } from "./utils.js";

export async function generateImage(
  providerName: string,
  params: ImageGenerateParams,
): Promise<GeneratedImage> {
  if (isRemovedImageModelId(params.model)) {
    throw new GenerationError("disabled", "model_not_found", `Retired image model: ${params.model}`);
  }
  const provider = getImageProvider(providerName);
  return provider.generate(params);
}
