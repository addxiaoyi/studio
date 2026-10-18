export type ModelCallProfile = {
  id: string;
  matches(model: string, apiFormat: string): boolean;
  requiresPublicImageUrl: boolean;
  minimumInputImageEdge?: number;
  inputImageTransport: "provider_url" | "data_uri" | "native";
  requestAdapter: string;
  responseAdapter: string;
  defaultImageSize?: string;
  mapImageQuality?(quality: string | undefined): string | undefined;
  acceptedDurations?: number[];
  acceptedAspectRatios?: string[];
  maxInputImages?: number;
  supportsAudio?: boolean;
  mapResolution(requested: string | undefined, configured: unknown): string | undefined;
  taskIdPaths: string[];
  videoUrlPaths: string[];
  pollPath?: (baseUrl: string, taskId: string) => string;
};

export type BuiltInModelFamily = ModelCallProfile["id"] | "metaso-minimax" | "google-image" | "volces-image" | "replicate-google-image" | "replicate-google-video";

export function classifyBuiltInModel(model: string, apiFormat = ""): BuiltInModelFamily {
  const id = model.toLowerCase();
  if (apiFormat === "lingke_media" && (id === "minimax-h3" || id === "minimax-h3-max")) return "minimax-lingke";
  if (apiFormat === "openai" && /^gpt-image/i.test(id) && id !== "gpt-image-1") return "kuaipao-image";
  if (apiFormat === "openai" && /^gpt-image-1$/i.test(id)) return "openai-image";
  if (apiFormat === "openai" && /^dall-e-3$/i.test(id)) return "openai-dalle-image";
  if (id.startsWith("metaso/minimax")) return "metaso-minimax";
  if (id.startsWith("google-official/gemini-") || apiFormat === "gemini") return "gemini-image";
  if (apiFormat === "replicate" && /flux/i.test(id)) return "flux-image";
  if (id.includes("kling")) return "replicate-kling";
  if (id.includes("seedance")) return "replicate-seedance";
  if (id.includes("wan-video")) return "replicate-wan";
  if (id.includes("sora")) return "replicate-sora";
  if (id.startsWith("minimax/hailuo")) return "replicate-hailuo";
  if (id.startsWith("google-official/veo")) return "google-veo";
  if (id.startsWith("google-vertex/veo")) return "google-vertex-veo";
  if (id.startsWith("google/veo-")) return "replicate-google-video";
  if (id.startsWith("gpt-image")) return "openai-image";
  if (id.startsWith("google/")) return "replicate-google-image";
  if (apiFormat === "volces" && (id.includes("doubao") || id.includes("seedream"))) return "volces-image";
  return "configured-generic";
}

const generic: ModelCallProfile = {
  id: "generic",
  matches: () => true,
  requiresPublicImageUrl: false,
  inputImageTransport: "native",
  requestAdapter: "configured-template",
  responseAdapter: "configured-response-paths",
  mapResolution: (requested, configured) => requested ?? (typeof configured === "string" ? configured : undefined),
  taskIdPaths: ["task_id", "id", "taskId", "data.task_id", "data.id", "data.taskId", "data.task.id", "data.task.task_id", "data.result.id", "data.result.task_id"],
  videoUrlPaths: ["video_url", "url", "result_url", "videoUrl", "result.video_url", "result.url", "data.video_url", "data.videoUrl", "data.url", "data.result.video_url", "data.result.videoUrl", "data.result.url", "data.task.url", "data.task.videoUrl"],
};

const minimaxLingke: ModelCallProfile = {
  ...generic,
  id: "minimax-lingke",
  matches: (model, apiFormat) => apiFormat === "lingke_media" && /minimax-h3/i.test(model),
  requiresPublicImageUrl: true,
  inputImageTransport: "provider_url",
  requestAdapter: "lingke-media",
  responseAdapter: "lingke-async-task",
  minimumInputImageEdge: 300,
  acceptedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  acceptedAspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  maxInputImages: 2,
  supportsAudio: false,
  mapResolution: (requested, configured) => {
    const wanted = requested?.toLowerCase();
    if (wanted === "1080p" || wanted === "4k") return "2K";
    if (wanted === "720p") return "768P";
    if (wanted) return wanted === "480p" ? "768P" : requested;
    if (typeof configured === "string" && !/^480p?$/i.test(configured)) return configured;
    return "768P";
  },
  pollPath: (baseUrl, taskId) => baseUrl.replace(/\/$/, "") + "/skills/task-status?task_id=" + encodeURIComponent(taskId),
};

const metasoMinimax: ModelCallProfile = {
  ...minimaxLingke,
  id: "metaso-minimax",
  matches: (model) => model === "metaso/minimax-h3",
  requestAdapter: "metaso-v2-video-generation",
  responseAdapter: "metaso-task-query",
  acceptedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  acceptedAspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  maxInputImages: 2,
  supportsAudio: false,
};

const openAiImage: ModelCallProfile = { ...generic, id: "openai-image", matches: (model, format) => format === "openai" && /^gpt-image/i.test(model), inputImageTransport: "native", requestAdapter: "openai-sdk-images-generate", responseAdapter: "openai-b64-or-url", defaultImageSize: "auto" };
const openAiDalle: ModelCallProfile = { ...generic, id: "openai-dalle-image", matches: (model, format) => format === "openai" && /^dall-e-3$/i.test(model), inputImageTransport: "native", requestAdapter: "openai-sdk-images-generate", responseAdapter: "openai-url-only", defaultImageSize: "1024x1024" };
const geminiImage: ModelCallProfile = { ...generic, id: "gemini-image", matches: (model, format) => format === "gemini" || /nano-banana|gemini.*image/i.test(model), inputImageTransport: "native", requestAdapter: "gemini-content-parts", responseAdapter: "gemini-inline-image", defaultImageSize: "1024x1024" };
const replicateGoogleImage: ModelCallProfile = { ...generic, id: "replicate-google-image", matches: (model, format) => format === "replicate" && model.startsWith("google/"), inputImageTransport: "provider_url", requestAdapter: "replicate-model-input:google-image", responseAdapter: "replicate-prediction-output", maxInputImages: 0 };
const replicateSeedreamImage: ModelCallProfile = { ...generic, id: "replicate-seedream-image", matches: (model, format) => format === "replicate" && model.startsWith("bytedance/seedream-"), inputImageTransport: "provider_url", requestAdapter: "replicate-model-input:seedream", responseAdapter: "replicate-prediction-output" };
const replicateFluxImage: ModelCallProfile = { ...generic, id: "replicate-flux-image", matches: (model, format) => format === "replicate" && model.startsWith("black-forest-labs/flux-"), inputImageTransport: "provider_url", requestAdapter: "replicate-model-input:flux", responseAdapter: "replicate-prediction-output" };
const replicateOpenAiImage: ModelCallProfile = { ...generic, id: "replicate-openai-image", matches: (model, format) => format === "replicate" && model === "openai/gpt-image-1", inputImageTransport: "provider_url", requestAdapter: "replicate-model-input:openai", responseAdapter: "replicate-prediction-output" };
const replicateRecraftImage: ModelCallProfile = { ...generic, id: "replicate-recraft-image", matches: (model, format) => format === "replicate" && model === "recraft-ai/recraft-v3", inputImageTransport: "native", requestAdapter: "replicate-model-input:recraft", responseAdapter: "replicate-prediction-output", maxInputImages: 0 };
const volcesImage: ModelCallProfile = { ...generic, id: "volces-image", matches: (model, format) => format === "volces" && (/doubao/i.test(model) || /seedream/i.test(model)), inputImageTransport: "native", requestAdapter: "volces-ark-images-generations", responseAdapter: "volces-url-or-b64-json", defaultImageSize: "1024x1024", maxInputImages: 0 };
const kuaipaoImage: ModelCallProfile = { ...openAiImage, id: "kuaipao-image", matches: (model, format) => format === "openai" && /^gpt-image/i.test(model) && model !== "gpt-image-1", requestAdapter: "kuaipao-image-endpoint", responseAdapter: "b64-json-or-url" };
const fluxImage: ModelCallProfile = { ...replicateFluxImage, id: "flux-image", matches: (model, format) => format === "replicate" && /flux/i.test(model), requestAdapter: "replicate-model-input:flux", responseAdapter: "replicate-prediction-output", defaultImageSize: "1024x1024" };
const replicateKling: ModelCallProfile = { ...generic, id: "replicate-kling", matches: (model) => /kling/i.test(model), inputImageTransport: "provider_url", requestAdapter: "replicate-model-input:kling", responseAdapter: "replicate-prediction-output", acceptedDurations: [3, 5, 10, 15], acceptedAspectRatios: ["16:9", "9:16", "1:1"], supportsAudio: true };
const replicateSeedance: ModelCallProfile = { ...generic, id: "replicate-seedance", matches: (model) => /seedance/i.test(model), inputImageTransport: "provider_url", requestAdapter: "replicate-model-input:seedance", responseAdapter: "replicate-prediction-output", acceptedDurations: [5, 10], acceptedAspectRatios: ["16:9", "9:16", "1:1"], maxInputImages: 1, supportsAudio: true };
const replicateWan: ModelCallProfile = { ...generic, id: "replicate-wan", matches: (model) => /wan-video/i.test(model), inputImageTransport: "provider_url", requestAdapter: "replicate-model-input:wan-t2v-i2v", responseAdapter: "replicate-prediction-output", acceptedDurations: [5, 10], acceptedAspectRatios: ["16:9", "9:16", "1:1"], maxInputImages: 1, supportsAudio: true };
const replicateSora: ModelCallProfile = { ...generic, id: "replicate-sora", matches: (model) => /sora/i.test(model), inputImageTransport: "provider_url", requestAdapter: "replicate-model-input:sora", responseAdapter: "replicate-prediction-output", acceptedDurations: [4, 6, 8, 10, 12], acceptedAspectRatios: ["16:9", "9:16", "1:1"], maxInputImages: 1, supportsAudio: true };
const replicateGoogleVideo: ModelCallProfile = { ...generic, id: "replicate-google-video", matches: (model) => model.startsWith("google/veo-"), inputImageTransport: "provider_url", requestAdapter: "replicate-model-input:google-veo", responseAdapter: "replicate-prediction-output", acceptedDurations: [4, 6, 8], acceptedAspectRatios: ["16:9", "9:16"], supportsAudio: true };
const replicateHailuo: ModelCallProfile = { ...generic, id: "replicate-hailuo", matches: (model) => model.startsWith("minimax/hailuo"), inputImageTransport: "provider_url", requestAdapter: "replicate-model-input:hailuo", responseAdapter: "replicate-prediction-output", acceptedDurations: [6, 10], acceptedAspectRatios: ["16:9", "9:16", "1:1"], maxInputImages: 1, supportsAudio: false };
const veoDeveloper: ModelCallProfile = { ...generic, id: "google-veo-developer", matches: (model) => model.startsWith("google-official/veo"), inputImageTransport: "data_uri", requestAdapter: "google-genai-video-operation", responseAdapter: "google-operation-poll-video-uri", acceptedDurations: [4, 6, 8], acceptedAspectRatios: ["16:9", "9:16"], maxInputImages: 1, supportsAudio: true };
const veo2Developer: ModelCallProfile = { ...veoDeveloper, id: "google-veo-2", matches: (model) => model === "google-official/veo-2.0-generate-001", acceptedDurations: [5, 6, 7, 8], supportsAudio: false };
const veoVertex: ModelCallProfile = { ...veoDeveloper, id: "google-veo-vertex", matches: (model) => model.startsWith("google-vertex/veo"), requestAdapter: "vertex-veo-operation", responseAdapter: "vertex-operation-poll-video-bytes-or-uri" };
const veo2Vertex: ModelCallProfile = { ...veoVertex, id: "google-vertex-veo-2", matches: (model) => model === "google-vertex/veo-2.0-generate-001", acceptedDurations: [5, 6, 7, 8], supportsAudio: false };
const profiles = [minimaxLingke, metasoMinimax, kuaipaoImage, openAiDalle, replicateGoogleImage, replicateSeedreamImage, replicateFluxImage, replicateOpenAiImage, replicateRecraftImage, volcesImage, geminiImage, veo2Vertex, veoVertex, veo2Developer, veoDeveloper, replicateGoogleVideo, replicateHailuo, replicateKling, replicateSeedance, replicateWan, replicateSora, fluxImage, openAiImage, generic];

export function getModelCallProfile(model: string, apiFormat: string): ModelCallProfile {
  return profiles.find((profile) => profile.matches(model, apiFormat)) ?? generic;
}

export function listModelCallProfiles(): readonly ModelCallProfile[] {
  return profiles;
}

export function validateProfileInput(profile: ModelCallProfile, input: { duration?: number; aspectRatio?: string; inputImageCount?: number; enableAudio?: boolean }): string | undefined {
  if (profile.acceptedDurations && input.duration != null && !profile.acceptedDurations.includes(input.duration)) return 'duration not supported: ' + input.duration;
  if (profile.acceptedAspectRatios && input.aspectRatio && !profile.acceptedAspectRatios.includes(input.aspectRatio)) return 'aspect ratio not supported: ' + input.aspectRatio;
  if (profile.maxInputImages === 0 && (input.inputImageCount ?? 0) > 0) return 'reference-image input is not supported';
  if (profile.maxInputImages != null && (input.inputImageCount ?? 0) > profile.maxInputImages) return 'too many reference images: ' + input.inputImageCount;
  if (input.enableAudio === true && profile.supportsAudio === false) return 'audio is not supported by this model';
  return undefined;
}
