import { tool } from "langchain";
import { z } from "zod";

import {
  type AvailableVideoModel,
  getAvailableVideoModels,
  resolveVideoProviderName,
} from "../../generation/providers/registry.js";
import { generateVideo } from "../../generation/video-generation.js";
import { getModelCallProfile, validateProfileInput } from "../../local-db/model-call-profiles.js";
import { isRemovedModelId } from "../../generation/removed-models.js";
import { readGenerationToolErrorCode, type GenerationToolErrorCode } from "./generation-error-code.js";

const DEFAULT_MODEL = "wan-video/wan-2.6";

// ── Submit function type ───────────────────────────────────────────────────

export type SubmitVideoJobFn = (input: {
  prompt: string;
  model: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  inputImages?: string[];
  inputAssetIds?: string[];
  inputVideo?: string;
  enableAudio?: boolean;
  idempotencyKey?: string;
}) => Promise<{
  jobId: string;
  elementId?: string;
  videoUrl?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  mimeType?: string;
  pending?: boolean;
  error?: string;
}>;

// ── Dynamic schema builder ─────────────────────────────────────────────────

function buildVideoGenerateSchema(models: AvailableVideoModel[], allowDynamicModelIds = false) {
  const modelIds = models.map((m) => m.id);
  const defaultModel = modelIds.includes(DEFAULT_MODEL)
    ? DEFAULT_MODEL
    : (modelIds[0] ?? DEFAULT_MODEL);

  const modelDescription = models.length
    ? `Video model to use. Choose one of: ${models.map((m) => `${m.id} (${m.displayName})`).join(", ")}. The server validates duration, resolution, and image/video capabilities.`
    : "Model identifier; the server validates availability and capabilities.";

  const modelField =
    allowDynamicModelIds
      ? z.string().min(1).default(defaultModel).describe(`${modelDescription} The workspace may also configure additional video model IDs; pass the selected ID verbatim and let the server validate it.`)
      : modelIds.length >= 1
      ? z
          .enum(modelIds as [string, ...string[]])
          .default(defaultModel as (typeof modelIds)[number])
          .describe(modelDescription)
      : z.string().default(DEFAULT_MODEL).describe(modelDescription);

  return z.object({
    title: z
      .string()
      .min(1)
      .optional()
      .default("AI生成视频")
      .describe(
        "Short descriptive title for the generated video, used as metadata so the video content is understood without re-analysis (e.g. 'Autumn forest bus scene', '恐龙追逐镜头')",
      ),
    prompt: z
      .string()
      .min(1)
      .describe(
        "Detailed video generation prompt. Be specific about motion, camera angles, lighting, mood, action, and scene transitions.",
      ),
    model: modelField,
    duration: z
      .number()
      .int()
      .min(3)
      .max(30)
      .describe(
        "REQUIRED. Exact video duration in seconds. Always copy the duration explicitly requested by the user; never omit it and never replace it with a default. If the selected model does not support this exact duration, return an error instead of changing the duration.",
      ),
    resolution: z
      .enum(["480p", "720p", "1080p", "4k"])
      .optional()
      .default("720p")
      .describe(
        "Output resolution. 720p recommended for balance of quality and speed. 1080p/4k supported by Google Veo official models (8s duration required).",
      ),
    aspectRatio: z
      .enum(["1:1", "16:9", "9:16", "4:3", "3:4"])
      .optional()
      .default("16:9")
      .describe(
        "Video aspect ratio. 16:9 for landscape, 9:16 for portrait/mobile.",
      ),
    inputImages: z
      .array(z.string())
      .max(7)
      .optional()
      .describe(
        "Reference image URLs for image-to-video. First image used as first frame. Only for models with I2V capability.",
      ),
    inputVideo: z
      .string()
      .optional()
      .describe(
        "Source video URL for video-to-video editing. Only for Kling O1.",
      ),
    enableAudio: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Generate synchronized audio (dialogue, sound effects, ambient). Audio is off by default; enable it only when the user explicitly requests it and the selected model supports it.",
      ),
    placementX: z
      .number()
      .optional()
      .describe(
        "Canvas X coordinate for video placement. Use inspect_canvas to find a good position.",
      ),
    placementY: z
      .number()
      .optional()
      .describe(
        "Canvas Y coordinate for video placement. Use inspect_canvas to find a good position.",
      ),
    placementWidth: z
      .number()
      .optional()
      .describe("Width on canvas (default: 640)"),
    placementHeight: z
      .number()
      .optional()
      .describe("Height on canvas (default: 360)"),
  });
}

// ── Result type ────────────────────────────────────────────────────────────

// Infer input type from schema — includes the new `title` field
type VideoGenerateInput = z.infer<ReturnType<typeof buildVideoGenerateSchema>>;

type VideoGenerateResult = {
  status?: "confirmation_required" | "job_created" | "job_running" | "job_succeeded" | "job_failed";
  summary: string;
  title?: string;
  prompt?: string;
  elementId?: string;
  videoUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  placement?: { x: number; y: number; width: number; height: number };
  error?: string;
  errorCode?: GenerationToolErrorCode;
  jobId?: string;
  jobType?: "video_generation";
  pending?: boolean;
};

// ── Run function ───────────────────────────────────────────────────────────

export async function runVideoGenerate(
  rawInput: VideoGenerateInput,
  submitVideoJob?: SubmitVideoJobFn,
  availableModels = getAvailableVideoModels(),
  attachmentMap?: Record<string, string>,
): Promise<VideoGenerateResult> {
  let input = rawInput;
  const t0 = Date.now();
  if (isRemovedModelId(input.model)) {
    return {
      status: "job_failed",
      summary: `The selected video model ${input.model} has been retired. Choose another available video model.`,
      error: "The selected video model has been retired.",
      errorCode: "model_not_found",
    };
  }
  const lap = (label: string, extra?: Record<string, unknown>) => {
    console.log(
      `[generate_video] ${label} +${Date.now() - t0}ms`,
      extra ? JSON.stringify(extra) : "",
    );
  };

  let inputAssetIdsByIndex: Array<string | undefined> | undefined;

  // Uploaded images are stored as asset IDs in the prompt. Resolve explicit
  // IDs first; for I2V requests with no explicit selection, use the first
  // uploaded image as the first frame.
  if (attachmentMap && Object.keys(attachmentMap).length > 0) {
    const requestedRefs = input.inputImages?.length
      ? input.inputImages
      : [Object.keys(attachmentMap)[0]!];
    const resolvedRefs = requestedRefs.map((ref) => ({
      url: attachmentMap[ref] ?? ref,
      ...(attachmentMap[ref] ? { assetId: ref } : {}),
    }));
    inputAssetIdsByIndex = resolvedRefs.map((ref) => ref.assetId);
    input = { ...input, inputImages: resolvedRefs.map((ref) => ref.url) };
  }

  // Filter invalid image references
  if (input.inputImages?.length) {
    const validIndexes = input.inputImages
      .map((image, index) => ({ image, index }))
      .filter(({ image }) => /^https?:\/\//i.test(image) || /^data:/i.test(image))
      .map(({ index }) => index);
    const validImages = validIndexes.map((index) => input.inputImages![index]!);
    input = {
      ...input,
      inputImages: validImages.length > 0 ? validImages : undefined,
    };
    if (inputAssetIdsByIndex?.length) {
      const validAssetIds = validIndexes
        .map((index) => inputAssetIdsByIndex![index])
        .filter((assetId): assetId is string => Boolean(assetId));
      inputAssetIdsByIndex = validAssetIds.length > 0 ? validAssetIds : undefined;
    }
  }

  if (attachmentMap && Object.keys(attachmentMap).length > 0 && !input.inputImages?.length) {
    return {
      summary: "Video generation stopped because the uploaded first-frame image could not be resolved.",
      error: "The uploaded reference image is not available as a usable first frame. Please re-upload it and try again.",
    };
  }

  const selectedModel = availableModels.find(
    (candidate) => candidate.id === input.model,
  );
  if (!selectedModel && !submitVideoJob) {
    return {
      summary: `Video generation failed: model ${input.model} is not available`,
      error: `Video model is not available: ${input.model}`,
    };
  }

  const capabilityError = selectedModel
    ? validateCapabilities(input, selectedModel)
    : undefined;
  if (capabilityError) {
    return {
      summary: `Video generation failed with model ${input.model}: ${capabilityError}`,
      error: capabilityError,
      errorCode: "invalid_input",
    };
  }

  if (!selectedModel && submitVideoJob) {
    const profileError = validateProfileInput(getModelCallProfile(input.model, "lingke_media"), {
      duration: input.duration,
      aspectRatio: input.aspectRatio,
      ...(input.inputImages?.length ? { inputImageCount: input.inputImages.length } : {}),
      enableAudio: input.enableAudio,
    });
    if (profileError) {
      return { status: "job_failed", summary: "Video generation input is incompatible with " + input.model + ": " + profileError, error: profileError, errorCode: "invalid_input" };
    }
  }

  const enableAudio = selectedModel?.capabilities.audio
    ? input.enableAudio
    : undefined;

  // Job mode: submit to PGMQ and wait for worker
  if (submitVideoJob) {
    try {
      lap("job_submit", { model: input.model });
      const inputAssetIds = inputAssetIdsByIndex?.filter((assetId): assetId is string => Boolean(assetId));
      const jobResult = await submitVideoJob({
        prompt: input.prompt,
        model: input.model,
        duration: input.duration,
        resolution: input.resolution,
        aspectRatio: input.aspectRatio,
        ...(input.inputImages ? { inputImages: input.inputImages } : {}),
        ...(inputAssetIds?.length ? { inputAssetIds } : {}),
        ...(input.inputVideo ? { inputVideo: input.inputVideo } : {}),
        ...(enableAudio != null ? { enableAudio } : {}),
      });

      if (jobResult.pending) {
        return {
          status: "job_running",
          summary: "视频任务仍在后台处理中，尚未失败。请等待当前任务结果，不要重新提交。",
          pending: true,
          jobId: jobResult.jobId,
          jobType: "video_generation",
        };
      }

      if (jobResult.error) {
        lap("job_failed", { error: jobResult.error });
        const isTimeout = jobResult.error.includes("timed out");
        return {
          status: "job_failed",
          summary: isTimeout
            ? "Video is still being generated by the server. It will automatically appear on the canvas once ready — no action needed from the user."
            : `Video generation failed with model ${input.model}: ${jobResult.error}. Consider trying a different model or simplifying the prompt.`,
          error: jobResult.error,
          // Expose jobId so frontend can poll for late-arriving results
          // (worker may still succeed after agent poll timeout)
          jobType: "video_generation" as const,
        };
      }
      lap("job_complete", { jobId: jobResult.jobId });

      const result: VideoGenerateResult = {
        status: "job_succeeded",
        summary: `Generated ${jobResult.durationSeconds ?? input.duration}s video (${jobResult.width ?? 0}x${jobResult.height ?? 0}) via ${input.model}`,
        title: input.title,
        prompt: input.prompt,
        ...(jobResult.elementId != null
          ? { elementId: jobResult.elementId }
          : {}),
        mimeType: jobResult.mimeType ?? "video/mp4",
        ...(jobResult.videoUrl != null ? { videoUrl: jobResult.videoUrl } : {}),
        ...(jobResult.width != null ? { width: jobResult.width } : {}),
        ...(jobResult.height != null ? { height: jobResult.height } : {}),
        ...(jobResult.durationSeconds != null
          ? { durationSeconds: jobResult.durationSeconds }
          : {}),
      };
      if (input.placementX != null && input.placementY != null) {
        result.placement = {
          x: input.placementX,
          y: input.placementY,
          width: input.placementWidth ?? 640,
          height: input.placementHeight ?? 360,
        };
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const detectedCode = readGenerationToolErrorCode(error);
      const approvalPrefix = "GENERATION_CONFIRMATION_REQUIRED:";
      if (message.startsWith(approvalPrefix)) {
        try {
          return { status: "confirmation_required", summary: "Confirmation required before credits are charged.", ...JSON.parse(message.slice(approvalPrefix.length)) } as VideoGenerateResult;
        } catch {
          return { status: "job_failed", summary: "Generation confirmation could not be prepared.", error: "Generation confirmation could not be prepared." } as VideoGenerateResult;
        }
      }
      const isSelectionError = message.startsWith("MODEL_SELECTION_REQUIRED:");
      const cleanMessage = isSelectionError
        ? message.replace(/^MODEL_SELECTION_REQUIRED:\s*/i, "")
        : message;
      return {
        status: "job_failed",
        summary: isSelectionError ? cleanMessage : `Video generation failed with model ${input.model}: ${cleanMessage}`,
        error: cleanMessage,
        ...(isSelectionError
          ? { errorCode: "model_selection_required" as const }
          : detectedCode ? { errorCode: detectedCode } : {}),
      };
    }
  }

  // Direct mode: call provider directly
  try {
    lap("direct_generate_start", { model: input.model });
    const providerName = resolveVideoProviderName(input.model);
    const result = await generateVideo(providerName, {
      prompt: input.prompt,
      model: input.model,
      duration: input.duration,
      aspectRatio: input.aspectRatio,
      ...(input.resolution
        ? { resolution: input.resolution as "480p" | "720p" | "1080p" }
        : {}),
      ...(input.inputImages ? { inputImages: input.inputImages } : {}),
      ...(input.inputVideo ? { inputVideo: input.inputVideo } : {}),
      ...(enableAudio != null ? { enableAudio } : {}),
    });
    lap("direct_generate_done");

    const directResult: VideoGenerateResult = {
      summary: `Generated ${result.durationSeconds}s video (${result.width}x${result.height}) via ${input.model}`,
      title: input.title,
      prompt: input.prompt,
      videoUrl: result.url,
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
      durationSeconds: result.durationSeconds,
    };
    if (input.placementX != null && input.placementY != null) {
      directResult.placement = {
        x: input.placementX,
        y: input.placementY,
        width: input.placementWidth ?? 640,
        height: input.placementHeight ?? 360,
      };
    }
    return directResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const detectedCode = readGenerationToolErrorCode(error);
    return {
      summary: `Video generation failed: ${message}`,
      error: message,
      ...(detectedCode ? { errorCode: detectedCode } : {}),
    };
  }
}

// ── Tool factory ───────────────────────────────────────────────────────────

export function createVideoGenerateTool(deps?: {
  submitVideoJob?: SubmitVideoJobFn;
  availableModels?: AvailableVideoModel[];
  allowDynamicModelIds?: boolean;
}) {
  const models = deps?.availableModels ?? getAvailableVideoModels();

  const modelSummary = models.length
    ? models.map((m) => `${m.displayName} (${m.id})`).join(", ")
    : "No video models available";

  return tool(
    async (input: VideoGenerateInput, config) => {
      const attachmentMap = (config as { configurable?: { user_attachment_map?: Record<string, string> } })
        .configurable?.user_attachment_map;
      return await runVideoGenerate(
        input,
        deps?.submitVideoJob,
        models,
        attachmentMap,
      );
    },
    {
      name: "generate_video",
      description: `Generate a video using AI. Available models: ${modelSummary}. Supports text-to-video, image-to-video, and video editing. Returns the generated video URL.`,
      schema: buildVideoGenerateSchema(models, deps?.allowDynamicModelIds === true),
    },
  );
}

function validateCapabilities(
  input: VideoGenerateInput,
  model: AvailableVideoModel,
): string | undefined {
  if (input.inputImages?.length && !model.capabilities.imageToVideo) {
    return `${model.displayName} does not support image-to-video input`;
  }
  if ((input.inputImages?.length ?? 0) > model.limits.maxInputImages) {
    return `${model.displayName} accepts at most ${model.limits.maxInputImages} input image(s)`;
  }
  if (input.inputVideo && !model.capabilities.videoToVideo) {
    return `${model.displayName} does not support reference-video input`;
  }
  if (input.duration > model.limits.maxDuration) {
    return `${model.displayName} supports at most ${model.limits.maxDuration} seconds`;
  }
  if (
    model.limits.allowedDurations &&
    !model.limits.allowedDurations.includes(input.duration)
  ) {
    return `${model.displayName} supports durations: ${model.limits.allowedDurations.join(", ")} seconds`;
  }

  const requestedResolution =
    input.resolution === "4k" ? "2160p" : input.resolution;
  const resolutionRank = {
    "480p": 0,
    "720p": 1,
    "1080p": 2,
    "2160p": 3,
  } as const;
  if (
    resolutionRank[requestedResolution] >
    resolutionRank[model.limits.maxResolution]
  ) {
    return `${model.displayName} supports up to ${model.limits.maxResolution}`;
  }

  return undefined;
}
