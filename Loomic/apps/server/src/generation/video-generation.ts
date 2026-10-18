import type { GeneratedVideo, VideoGenerateParams } from "./types.js";
import { getVideoProvider } from "./providers/registry.js";
import { isRemovedModelId } from "./removed-models.js";
import { GenerationError } from "./utils.js";

export async function generateVideo(
  providerName: string,
  params: VideoGenerateParams,
): Promise<GeneratedVideo> {
  if (isRemovedModelId(params.model)) {
    throw new GenerationError("disabled", "model_not_found", `Retired video model: ${params.model}`);
  }
  const provider = getVideoProvider(providerName);
  return provider.generate(params);
}
