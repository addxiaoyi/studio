import { tool } from "langchain";
import { z } from "zod";

import { randomUUID } from "node:crypto";
import { isRemovedImageModelId } from "../../generation/removed-models.js";
import { getModelCallProfile, validateProfileInput } from "../../local-db/model-call-profiles.js";
import { readGenerationToolErrorCode, type GenerationToolErrorCode } from "./generation-error-code.js";

import { generateImage } from "../../generation/image-generation.js";
import {
  getAvailableImageModels,
  resolveImageProviderName,
  type AvailableModel,
} from "../../generation/providers/registry.js";

const DEFAULT_MODEL = "gpt-image-2";
const PREFERRED_MODEL = "gpt-image-2";

/**
 * Build the zod schema dynamically from the models available in the registry.
 * Falls back to a plain string field when no providers are registered.
 */
export function buildImageGenerateSchema(models: AvailableModel[]) {
  const modelIds = models.map((m) => m.id);
  const defaultModel = modelIds.includes(DEFAULT_MODEL)
    ? DEFAULT_MODEL
    : modelIds[0] ?? DEFAULT_MODEL;

  const modelDescription = models.length
    ? `Model to use. Choose one of: ${models.map((m) => `${m.id} (${m.displayName})`).join(", ")}. Capabilities are checked by the server.`
    : "Model identifier; the server checks availability and capability.";

  // Local mode routes models from PostgreSQL, which can change without a
  // server deploy. Runtime provider resolution remains the source of truth.
  const modelField = z
    .string()
    .trim()
    .min(1)
    .default(defaultModel)
    .describe(modelDescription);

  return z.object({
    title: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Short descriptive title for the generated image, used as metadata so the image content is understood without re-analysis",
      ),
    prompt: z
      .string()
      .trim()
      .min(1)
      .describe("Required: the actual image description based on the user's request, including subject, layout and requested text. Never omit or invent a generic reference-image prompt."),
    model: modelField,
    aspectRatio: z
      .string()
      .optional()
      .default("1:1")
      .describe("Aspect ratio (e.g. 1:1, 16:9, 9:16, 4:3, 3:4, 4:5, 5:4, 2:3, 3:2). Provider auto-normalizes unsupported ratios to nearest match."),
    quality: z
      .enum(["standard", "hd", "ultra"])
      .optional()
      .default("hd")
      .describe(
        "Image quality/resolution level. standard: ~1K fast preview, hd: ~2K production quality (default), ultra: ~4K print quality (not all models support this, will use max available).",
      ),
    outputFormat: z
      .enum(["png", "jpg", "webp"])
      .optional()
      .describe("Output image format. PNG for transparency, JPG for photos, WebP for web."),
    inputImages: z
      .array(z.string().trim().min(1).max(12_000_000))
      .max(14)
      .optional()
      .describe(
        "Reference image URLs for editing/transformation. Google models accept up to 14, Flux models accept 1. Imagen 4 and Recraft V3 are text-only.",
      ),
    placementX: z
      .number()
      .optional()
      .describe(
        "Left edge x coordinate on canvas. Use inspect_canvas to determine position.",
      ),
    placementY: z
      .number()
      .optional()
      .describe(
        "Top edge y coordinate on canvas. Use inspect_canvas to determine position.",
      ),
    placementWidth: z
      .number()
      .optional()
      .default(512)
      .describe("Display width on canvas"),
    placementHeight: z
      .number()
      .optional()
      .default(512)
      .describe("Display height on canvas"),
  });
}

type ImageGenerateInput = {
  title: string;
  prompt: string;
  model: string;
  aspectRatio?: string;
  quality?: string;
  outputFormat?: string;
  inputImages?: string[];
  placementX?: number;
  placementY?: number;
  placementWidth?: number;
  placementHeight?: number;
};

type ImageGenerateResult = {
  status?: "confirmation_required" | "job_created" | "job_running" | "job_succeeded" | "job_failed";
  summary: string;
  title?: string;
  elementId?: string;
  imageUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  error?: string;
  errorCode?: GenerationToolErrorCode;
  jobId?: string;
  jobType?: "image_generation";
  pending?: boolean;
  placement?: { x: number; y: number; width: number; height: number };
};

/**
 * Optional function to persist a generated image to OSS.
 * Accepts the ephemeral URL and returns a persistent signed URL.
 */
export type PersistImageFn = (
  sourceUrl: string,
  mimeType: string,
  prompt: string,
) => Promise<string>;

/**
 * Submit an image generation job and wait for it to complete.
 * Returns the final result: signed_url on success, error on failure.
 */
export type SubmitImageJobFn = (input: {
  prompt: string;
  title: string;
  model: string;
  aspectRatio: string;
  inputImages?: string[];
  inputAssetIds?: string[];
  idempotencyKey?: string;
  quality?: string;
}) => Promise<{
  jobId: string;
  reused?: boolean;
  reactivated?: boolean;
  pending?: boolean;
  elementId?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  error?: string;
}>;

export async function runImageGenerate(
  input: ImageGenerateInput,
  persistImage?: PersistImageFn,
  submitImageJob?: SubmitImageJobFn,
  attachmentMap?: Record<string, string>,
): Promise<ImageGenerateResult> {
  const t0 = Date.now();
  if (!input.prompt?.trim()) {
    return {
      summary: "未提交图片任务：缺少具体提示词。请根据用户的真实需求填写 prompt 后再调用工具。",
      error: "图片提示词不能为空；没有提交生成任务或扣费。",
    };
  }
  if (isRemovedImageModelId(input.model)) {
    return {
      status: "job_failed",
      summary: `The selected image model ${input.model} has been retired. Choose another available image model.`,
      error: "The selected image model has been retired.",
      errorCode: "model_not_found" as const,
    };
  }
  input = {
    ...input,
    title: input.title?.trim() || "AI生成图片",
    prompt: input.prompt.trim(),
  };
  const lap = (label: string, extra?: Record<string, unknown>) => {
    console.log(`[generate_image] ${label} +${Date.now() - t0}ms`, extra ? JSON.stringify(extra) : "");
  };

  let inputAssetIds: string[] | undefined;
  const imageRefs = input.inputImages?.map((ref) => ({
    url: attachmentMap?.[ref] ?? ref,
    ...(attachmentMap?.[ref] ? { assetId: ref } : {}),
  }));

  // Filter out invalid image references — only keep valid URLs.
  // Agent may pass canvas element IDs or unresolved assetIds that aren't
  // in the attachmentMap. These would cause Replicate 422 errors.
  if (imageRefs?.length) {
    const validRefs = imageRefs.filter(({ url }) =>
      /^https?:\/\//i.test(url) || /^data:/i.test(url),
    );
    if (validRefs.length !== imageRefs.length) {
      lap("filtered_invalid_refs", {
        before: imageRefs.length,
        after: validRefs.length,
        droppedCount: imageRefs.length - validRefs.length,
      });
    }
    if (validRefs.length === 0) {
      return {
        status: "job_failed",
        summary: "Reference images could not be resolved. No generation was submitted.",
        error: "Reference images could not be resolved.",
        errorCode: "invalid_input",
      };
    }
    inputAssetIds = validRefs.flatMap((ref) => ref.assetId ? [ref.assetId] : []);
    input = {
      ...input,
      inputImages: validRefs.map((ref) => ref.url),
    };
  }

  // Job mode: submit to PGMQ and wait for worker to complete
  if (submitImageJob) {
    const profileError = validateProfileInput(getModelCallProfile(input.model, "replicate"), {
      ...(input.inputImages?.length ? { inputImageCount: input.inputImages.length } : {}),
    });
    if (profileError) {
      return {
        status: "job_failed",
        summary: `Image generation input is incompatible with ${input.model}: ${profileError}`,
        error: profileError,
        errorCode: "invalid_input",
      };
    }
    try {
      lap("job_submit", { model: input.model });
      let jobResult = await submitImageJob({
        prompt: input.prompt,
        title: input.title,
        model: input.model,
        aspectRatio: input.aspectRatio ?? "1:1",
        ...(input.quality ? { quality: input.quality } : {}),
        ...(input.inputImages ? { inputImages: input.inputImages } : {}),
        ...(inputAssetIds?.length ? { inputAssetIds } : {}),
      });

      if (jobResult.reused && !jobResult.reactivated) {
        return {
          summary: "本轮图片任务已提交，请使用首次调用结果。不要再次生成或自动重试；如任务失败，请向用户说明原因。",
        };
      }

      if (jobResult.pending) {
        return {
          status: "job_running",
          summary: "图片任务仍在后台处理中，尚未失败。请等待当前任务结果，不要重新提交或追加版本。",
          pending: true,
          jobId: jobResult.jobId,
          jobType: "image_generation",
        };
      }

      if (jobResult.error) {
        lap("job_failed", { error: jobResult.error });
        const isTimeout = jobResult.error.includes("timed out");
        return {
          status: "job_failed",
          summary: isTimeout
            ? `Image is still being generated by the server. It will automatically appear on the canvas once ready — no action needed from the user.`
            : `Image generation failed with model ${input.model}: ${jobResult.error}. Consider trying a different model or simplifying the prompt.`,
          error: jobResult.error,
          // Expose jobId so frontend can poll for late-arriving results
          // (worker may still succeed after agent poll timeout)
          ...(jobResult.jobId ? { jobId: jobResult.jobId } : {}),
          jobType: "image_generation" as const,
        };
      }
      lap("job_complete", { jobId: jobResult.jobId });

      const result: ImageGenerateResult = {
        status: "job_succeeded",
        jobId: jobResult.jobId,
        jobType: "image_generation",
        summary: `Generated image (${jobResult.width ?? 0}x${jobResult.height ?? 0}) via ${input.model}`,
        title: input.title,
        ...(jobResult.elementId != null ? { elementId: jobResult.elementId } : {}),
        imageUrl: jobResult.imageUrl ?? "",
        mimeType: jobResult.mimeType ?? "image/png",
        ...(jobResult.width != null ? { width: jobResult.width } : {}),
        ...(jobResult.height != null ? { height: jobResult.height } : {}),
      };
      if (input.placementX != null && input.placementY != null) {
        result.placement = {
          x: input.placementX,
          y: input.placementY,
          width: input.placementWidth ?? 512,
          height: input.placementHeight ?? 512,
        };
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const detectedCode = readGenerationToolErrorCode(error);
      const approvalPrefix = "GENERATION_CONFIRMATION_REQUIRED:";
      if (message.startsWith(approvalPrefix)) {
        try {
          return { status: "confirmation_required", summary: "Confirmation required before credits are charged.", ...JSON.parse(message.slice(approvalPrefix.length)) } as ImageGenerateResult;
        } catch {
          return { status: "job_failed", summary: "Generation confirmation could not be prepared.", error: "Generation confirmation could not be prepared." } as ImageGenerateResult;
        }
      }
      const isSelectionError = message.startsWith("MODEL_SELECTION_REQUIRED:");
      const cleanMessage = isSelectionError
        ? message.replace(/^MODEL_SELECTION_REQUIRED:\s*/i, "")
        : message;
      return {
        status: "job_failed",
        summary: isSelectionError ? cleanMessage : `Image generation failed with model ${input.model}: ${cleanMessage}. Consider trying a different model or simplifying the prompt.`,
        error: cleanMessage,
        ...(isSelectionError
          ? { errorCode: "model_selection_required" as const }
          : detectedCode ? { errorCode: detectedCode } : {}),
      };
    }
  }

  // Direct generation: resolve provider from model ID via registry
  try {
    lap("direct_generate_start", { model: input.model });
    const providerName = resolveImageProviderName(input.model);
    const result = await generateImage(providerName, {
      prompt: input.prompt,
      model: input.model,
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.quality ? { quality: input.quality as any } : {}),
      ...(input.outputFormat ? { outputFormat: input.outputFormat as any } : {}),
      ...(input.inputImages?.length ? { inputImages: input.inputImages } : {}),
    });
    lap("direct_generate_done", { width: result.width, height: result.height });

    let imageUrl = result.url;
    if (persistImage) {
      try {
        imageUrl = await persistImage(result.url, result.mimeType, input.prompt);
        lap("persist_image_done");
      } catch {
        // Fall back to ephemeral URL if upload fails
      }
    }

    const directResult: ImageGenerateResult = {
      status: "job_succeeded",
      summary: `Generated image (${result.width}x${result.height}) via ${input.model}`,
      title: input.title,
      imageUrl,
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
    };
    if (input.placementX != null && input.placementY != null) {
      directResult.placement = {
        x: input.placementX,
        y: input.placementY,
        width: input.placementWidth ?? 512,
        height: input.placementHeight ?? 512,
      };
    }
    return directResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const detectedCode = readGenerationToolErrorCode(error);
    return {
      summary: `Image generation failed: ${message}`,
      error: message,
      ...(detectedCode ? { errorCode: detectedCode } : {}),
    };
  }
}

export function createImageGenerateTool(deps?: {
  persistImage?: PersistImageFn;
  submitImageJob?: SubmitImageJobFn;
  /** Override for testing — defaults to querying the provider registry. */
  availableModels?: AvailableModel[];
}) {
  const models = deps?.availableModels ?? getAvailableImageModels();

  const modelSummary = models.length
    ? models.map((m) => `${m.displayName} (${m.id})`).join(", ")
    : "No models available";

  return tool(
    async (input: ImageGenerateInput, config) => {
      const attachmentMap =
        (config as any)?.configurable?.user_attachment_map as
          Record<string, string> | undefined;
      return await runImageGenerate(
        input,
        deps?.persistImage,
        deps?.submitImageJob,
        attachmentMap,
      );
    },
    {
      name: "generate_image",
      description: `Generate an image using AI. Available models: ${modelSummary}. Returns the generated image URL.`,
      schema: buildImageGenerateSchema(models),
    },
  );
}
