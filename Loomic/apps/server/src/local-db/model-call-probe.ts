import type { Pool } from "pg";
import { classifyBuiltInModel, getModelCallProfile } from "./model-call-profiles.js";
import { validateProfileInput } from "./model-call-profiles.js";
import { isRemovedImageModelId, isRemovedModelId } from "../generation/removed-models.js";

export type ModelCallProbeRow = {
  modelId: string; mediaType: string; providerLabel: string; baseUrl: string; apiFormat: string; family: string;
  verificationMode: "configuration_only";
  hasInputField: boolean; supportsInputImage: boolean; supportsInputVideo: boolean; supportsAudio: boolean;
  maxDurationSeconds: number | null; maxResolution: string | null;
  inputImageTransport: string; requestAdapter: string; responseAdapter: string;
  resolution: string | null; acceptedDurations: number[] | null; acceptedAspectRatios: string[] | null; maxInputImages: number | null;
  hasTaskIdMapping: boolean; hasVideoUrlMapping: boolean;
  callable: boolean; duplicateMappings: number; warnings: string[];
  inputImageStatus: "not_applicable" | "requires_public_url" | "supported" | "unsupported";
  requestPreview: { adapter: string; requiredFields: string[]; defaults: Record<string, unknown> };
  responseContract: { taskId: boolean; videoUrl: boolean; imageUrl: boolean };
};

export async function probeConfiguredModelCalls(db: Pool): Promise<ModelCallProbeRow[]> {
  const { rows } = await db.query<{
    model_id: string; media_type: string; label: string; base_url: string; api_format: string; supports_input_image: boolean | null; supports_input_video: boolean | null; supports_audio: boolean | null; max_duration_seconds: number | null;
    request_template: Record<string, unknown> | null; response_template: Record<string, unknown> | null;
    enabled: boolean; provider_enabled: boolean; provider_health: string; health_status: string;
    failure_count: number; cooldown_until: string | null; max_resolution: string | null; duplicate_mappings: number;
  }>("select pm.model_id,pm.media_type,pc.label,pc.base_url,pc.api_format,pc.request_template,pc.enabled as provider_enabled,pc.health_status as provider_health,pm.enabled,pm.health_status,pm.failure_count,pm.cooldown_until,pm.max_resolution,pm.supports_input_image,pm.supports_input_video,pm.supports_audio,pm.max_duration_seconds,pc.response_template,count(*) over(partition by lower(pm.model_id))::int as duplicate_mappings from provider_models pm join provider_configs pc on pc.id=pm.provider_id order by lower(pm.model_id),pm.priority");
  return rows.filter((row) => row.media_type === "image"
    ? !isRemovedImageModelId(row.model_id)
    : !isRemovedModelId(row.model_id)).map((row) => {
    const profile = getModelCallProfile(row.model_id, row.api_format);
    const template = row.request_template ?? {};
    const required = Array.isArray(template.required) ? template.required.map(String) : [];
    const response = row.response_template ?? {};
    const warnings: string[] = [];
    const customVideo = row.media_type === "video" && row.api_format === "custom";
    const customImage = row.media_type === "image" && row.api_format === "custom";
    const hasTaskIdMapping = customVideo ? typeof response.taskIdPath === "string" : profile.taskIdPaths.length > 0 || typeof response.taskIdPath === "string";
    const hasVideoUrlMapping = customVideo ? typeof response.videoUrlPath === "string" : profile.videoUrlPaths.length > 0 || typeof response.videoUrlPath === "string";
    if (!row.provider_enabled || !row.enabled) warnings.push("disabled");
    if (row.provider_health !== "healthy") warnings.push("provider_" + row.provider_health);
    if (row.health_status === "unhealthy" || row.failure_count >= 3) warnings.push("model_unhealthy");
    if (row.media_type === "video" && profile.requiresPublicImageUrl && !required.includes("images")) warnings.push("image_field_not_declared");
    if (row.media_type === "video" && !profile.acceptedDurations) warnings.push("duration_contract_unverified");
    if (row.media_type === "video" && !profile.acceptedAspectRatios) warnings.push("aspect_ratio_contract_unverified");
    const capabilityError = validateProfileInput(profile, { duration: 5, aspectRatio: "16:9", inputImageCount: required.includes("images") ? 1 : 0 });
    if (capabilityError) warnings.push("profile_smoke_invalid:" + capabilityError);
    if (classifyBuiltInModel(row.model_id, row.api_format) === "configured-generic" && row.api_format === "custom") warnings.push("unclassified_custom_model");
    if (customVideo && !hasTaskIdMapping) warnings.push("custom_task_id_path_missing");
    if (customVideo && !hasVideoUrlMapping) warnings.push("custom_video_url_path_missing");
    if (customImage && typeof response.imageUrlPath !== "string") warnings.push("image_response_contract_unverified");
    if (row.media_type === "video" && row.max_duration_seconds != null && profile.acceptedDurations && Math.max(...profile.acceptedDurations) > Number(row.max_duration_seconds)) {
      warnings.push("profile_duration_exceeds_database_limit");
    }
    if (row.media_type === "video" && row.supports_audio === false && profile.supportsAudio === true) {
      warnings.push("profile_audio_exceeds_database_capability");
    }
    if (row.media_type === "video" && row.supports_input_image === true && profile.maxInputImages === 0) {
      warnings.push("profile_image_input_exceeds_database_capability");
    }
    if (row.duplicate_mappings > 1) warnings.push("duplicate_model_mappings:" + row.duplicate_mappings);
    if (profile.acceptedDurations && profile.acceptedDurations.length === 0) warnings.push("duration_contract_empty");
    if (profile.acceptedAspectRatios && profile.acceptedAspectRatios.length === 0) warnings.push("aspect_ratio_contract_empty");
    const responseContractValid = !customVideo || (hasTaskIdMapping && hasVideoUrlMapping);
    return {
      modelId: row.model_id, mediaType: row.media_type, providerLabel: row.label, baseUrl: row.base_url, apiFormat: row.api_format,
      verificationMode: "configuration_only",
      family: classifyBuiltInModel(row.model_id, row.api_format), hasInputField: Boolean(row.supports_input_image) || required.includes("images") || required.includes("input_images"),
      supportsInputImage: Boolean(row.supports_input_image), supportsInputVideo: Boolean(row.supports_input_video), supportsAudio: Boolean(row.supports_audio),
      maxDurationSeconds: row.max_duration_seconds ?? null, maxResolution: row.max_resolution ?? null,
      inputImageTransport: profile.inputImageTransport, requestAdapter: profile.requestAdapter, responseAdapter: profile.responseAdapter,
      acceptedDurations: profile.acceptedDurations ?? null, acceptedAspectRatios: profile.acceptedAspectRatios ?? null, maxInputImages: profile.maxInputImages ?? null,
      duplicateMappings: row.duplicate_mappings,
      resolution: profile.mapResolution(undefined, (template.defaults as Record<string, unknown> | undefined)?.resolution) ?? row.max_resolution ?? null,
      hasTaskIdMapping,
      hasVideoUrlMapping,
      callable: responseContractValid && row.provider_enabled && row.enabled && row.provider_health === "healthy" && row.health_status !== "unhealthy" && row.failure_count < 3 && (!row.cooldown_until || new Date(row.cooldown_until).getTime() <= Date.now()),
      warnings,
      inputImageStatus: row.media_type !== "video" ? "not_applicable" : profile.requiresPublicImageUrl ? "requires_public_url" : profile.maxInputImages === 0 ? "unsupported" : "supported",
      requestPreview: { adapter: profile.requestAdapter, requiredFields: required, defaults: (template.defaults as Record<string, unknown> | undefined) ?? {} },
      responseContract: { taskId: hasTaskIdMapping, videoUrl: hasVideoUrlMapping, imageUrl: customImage ? typeof response.imageUrlPath === "string" : true },
    };
  });
}
