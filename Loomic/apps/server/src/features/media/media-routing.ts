import type { MediaIntent, MediaRoute } from "@helstera/shared";

type ModelCapabilities = {
  model_id: string;
  supports_input_image?: boolean;
  supports_input_video?: boolean;
  supports_audio?: boolean;
  max_duration_seconds?: number | null;
  max_resolution?: string | null;
};

export class MediaRoutingError extends Error {
  constructor(readonly code: "invalid_input" | "model_selection_required", message: string) {
    super(message);
    this.name = "MediaRoutingError";
  }
}

export function normalizeMediaIntent(intent: MediaIntent, model: ModelCapabilities): MediaRoute["normalized"] {
  const imageCount = intent.inputImageCount;
  if (imageCount > 0 && model.supports_input_image === false) {
    throw new MediaRoutingError("invalid_input", `${model.model_id} does not support reference images.`);
  }
  if (intent.inputVideo && model.supports_input_video === false) {
    throw new MediaRoutingError("invalid_input", `${model.model_id} does not support reference video.`);
  }
  if (intent.enableAudio && model.supports_audio === false) {
    throw new MediaRoutingError("invalid_input", `${model.model_id} does not support generated audio.`);
  }
  if (intent.durationSeconds != null && model.max_duration_seconds != null && intent.durationSeconds > model.max_duration_seconds) {
    throw new MediaRoutingError("invalid_input", `${model.model_id} supports at most ${model.max_duration_seconds} seconds.`);
  }
  return {
    enableAudio: intent.enableAudio && model.supports_audio !== false,
    inputImageCount: imageCount,
    ...(intent.durationSeconds != null ? { durationSeconds: intent.durationSeconds } : {}),
    ...(intent.resolution ? { resolution: intent.resolution } : {}),
  };
}

export function buildMediaRoute(input: {
  intent: MediaIntent;
  selected: ModelCapabilities;
  candidates: string[];
  reason?: string | null;
}): MediaRoute {
  const normalized = normalizeMediaIntent(input.intent, input.selected);
  const requestedModel = input.intent.requestedModel ?? null;
  const fallback = Boolean(requestedModel && requestedModel.toLowerCase() !== input.selected.model_id.toLowerCase());
  if (input.intent.selectionMode === "manual" && fallback) {
    throw new MediaRoutingError("model_selection_required", `Selected model ${requestedModel} is unavailable.`);
  }
  return {
    requestedModel,
    selectedModel: input.selected.model_id,
    selectionMode: input.intent.selectionMode,
    fallback,
    reason: input.reason ?? (fallback ? "requested model unavailable; selected a compatible healthy model" : null),
    candidateModels: input.candidates,
    requestedModels: input.candidates,
    preferredModel: requestedModel,
    inputImage: normalized.inputImageCount > 0,
    ...(normalized.durationSeconds != null ? { duration: normalized.durationSeconds } : {}),
    ...(normalized.resolution ? { resolution: normalized.resolution } : {}),
    normalized,
  };
}
