// @credits-system — Direct generation routes with credit deduction and tier checks
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  applicationErrorResponseSchema,
  resolveVideoResolution,
  unauthenticatedErrorResponseSchema,
  type ImageQualityLevel,
  type VideoResolution,
} from "@helstera/shared";

import { generateImage } from "../generation/image-generation.js";
import { generateConfiguredImage } from "../local-db/provider-generation.js";
import { getAvailableVideoModels, resolveImageProviderName } from "../generation/providers/registry.js";
import { resolveConfiguredModel } from "./model-availability.js";
import type { CreditService } from "../features/credits/credit-service.js";
import { CreditServiceError } from "../features/credits/credit-service.js";
import type { TierGuard } from "../features/credits/tier-guard.js";
import { TierGuardError } from "../features/credits/tier-guard.js";
import type { JobService } from "../features/jobs/job-service.js";
import { JobServiceError } from "../features/jobs/job-service.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { UploadService } from "../features/uploads/upload-service.js";
import type { AuthenticatedUser, RequestAuthenticator } from "../auth/types.js";
import { approvalRequiredResponse } from "./generation-approvals.js";
import { isRemovedImageModelId } from "../generation/removed-models.js";
import {
  createGenerationApprovalService,
  GenerationApprovalError,
} from "../features/generation/generation-approval-service.js";
import { buildMediaRoute } from "../features/media/media-routing.js";
import { createProviderAssetUrl } from "../features/uploads/provider-asset-url.js";

const generateImageRequestSchema = z.object({
  prompt: z.string().max(12_000).default(""),
  inputImages: z.array(z.string().max(12_000_000)).max(3).optional(),
  model: z.string().optional(),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  quality: z.enum(["standard", "hd", "ultra"]).optional(),
}).refine((payload) => payload.prompt.trim().length > 0 || (payload.inputImages?.length ?? 0) > 0, {
  message: "Prompt or reference image is required.",
  path: ["prompt"],
});

const generateVideoRequestSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  duration: z.number().int().min(3).max(30).optional(),
  resolution: z.enum(["480p", "720p", "768p", "1080p", "1088p", "1440p", "2160p", "4k"]).optional(),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  inputImages: z.array(z.string()).max(3).optional(),
  enableAudio: z.boolean().optional(),
});

export async function registerGenerateRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    creditService?: CreditService;
    jobService?: JobService;
    tierGuard?: TierGuard;
    uploadService: UploadService;
    viewerService: ViewerService;
    localDb?: import("pg").Pool;
  },
) {
  const approvalService = options.localDb
    ? createGenerationApprovalService(options.localDb)
    : undefined;
  app.post("/api/agent/generate-image", { bodyLimit: 36 * 1024 * 1024 }, async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) {
      return reply.code(401).send(
        unauthenticatedErrorResponseSchema.parse({
          error: {
            code: "unauthorized",
            message: "Missing or invalid bearer token.",
          },
        }),
      );
    }

    let payload: z.infer<typeof generateImageRequestSchema>;
    try {
      payload = generateImageRequestSchema.parse(request.body);
    } catch (error) {
      return reply.code(400).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "invalid_request",
            message: "Invalid request body.",
          },
        }),
      );
    }

    const requestedModel = payload.model ?? (options.localDb ? "gpt-image-2" : "black-forest-labs/flux-kontext-pro");
    if (isRemovedImageModelId(requestedModel)) {
      return reply.code(410).send({ error: { code: "model_retired", message: "The selected image model has been retired." } });
    }
    const canResolveConfiguredModel = Boolean(options.localDb && typeof (options.localDb as { query?: unknown }).query === "function");
    const configuredModel = canResolveConfiguredModel
      ? await resolveConfiguredModel(options.localDb!, "image", requestedModel, {
          strictRequested: Boolean(payload.model),
          allowUnverified: true,
        })
      : null;
    if (canResolveConfiguredModel && !configuredModel) {
      return reply.code(422).send({
        error: { code: "image_model_unavailable", message: "The selected image model is unavailable." },
      });
    }
    const model = configuredModel?.model_id ?? requestedModel;

    let creditsCost = 0;
    let directImageDebit: { workspaceId: string; userId: string; amount: number } | null = null;
    try {
      // ── Tier guard + credit checks ──
      const viewer = await options.viewerService.ensureViewer(user);
      if (options.creditService && options.tierGuard) {
        // Top-up credit system: no plan-based restrictions.
        const quality: ImageQualityLevel = payload.quality ?? "hd";
        await options.tierGuard.checkModelAccess(model);
        options.tierGuard.checkResolution(quality);
        await options.tierGuard.checkConcurrency(viewer.workspace.id);
        creditsCost = await options.tierGuard.calculateCreditCost(model, "image_generation", { quality });
      }

      const params = {
        prompt: payload.prompt,
        model,
        aspectRatio: payload.aspectRatio ?? "1:1",
        ...(payload.inputImages?.length ? { inputImages: payload.inputImages } : {}),
        ...(payload.quality ? { quality: payload.quality } : {}),
      };
      if (approvalService && creditsCost > 0) {
        const gate = await approvalService.gate({
          workspaceId: viewer.workspace.id,
          userId: user.id,
          jobType: "image_generation",
          model,
          payload: params,
          estimatedCredits: creditsCost,
          ...(request.headers["x-generation-approval"]
            ? { approvalId: request.headers["x-generation-approval"] as string }
            : {}),
        });
        if (gate.state === "confirmation_required") {
          return reply.code(409).send(approvalRequiredResponse(gate.request));
        }
      }
      if (options.creditService && creditsCost > 0) {
        await options.creditService.deductCredits(
          viewer.workspace.id, user.id, creditsCost, undefined,
          "Image generation",
        );
        directImageDebit = { workspaceId: viewer.workspace.id, userId: user.id, amount: creditsCost };
      }
      const providerInputOptions = payload.inputImages?.length && (needsPublicReferenceUrl(model) || payload.inputImages.some((inputUrl) => /\/api\/uploads\//i.test(inputUrl)))
        ? {
            providerUrlForInput: async (inputUrl: string) => {
              if (/^data:/i.test(inputUrl)) return inputUrl;
              if (/^https?:\/\//i.test(inputUrl)) return inputUrl;
              const assetId = inputUrl.match(/\/api\/uploads\/([0-9a-f-]{36})\/file(?:[?#]|$)/i)?.[1];
              if (assetId) {
                const secret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
                const origin = requestOrigin(request);
                if (!secret || !origin) {
                  throw Object.assign(new Error("Provider asset signing is not configured"), { code: "invalid_input" });
                }
                return createProviderAssetUrl({ origin, assetId, secret });
              }
              throw Object.assign(
                new Error("Reference images for this model must be public HTTP(S) URLs or uploaded workspace assets."),
                { code: "invalid_input" },
              );
            },
          }
        : undefined;
      const result = options.localDb
        ? providerInputOptions
          ? await generateConfiguredImage(options.localDb, model, params, providerInputOptions)
          : await generateConfiguredImage(options.localDb, model, params)
        : await generateImage(resolveImageProviderName(model), params);
      if (!result) {
        throw new Error("所选图片模型当前没有可调用渠道，请检查渠道健康状态和冷却时间。");
      }

      // Download and persist to Supabase Storage
      const { signedUrl, assetId } = await downloadAndUpload(
        result.url,
        result.mimeType,
        payload.prompt,
        user,
        options,
      );
      directImageDebit = null;

      return reply.code(200).send({
        url: signedUrl,
        assetId,
        prompt: payload.prompt,
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
      });
    } catch (error) {
      if (directImageDebit && options.creditService) {
        await options.creditService
          .refundCredits(
            directImageDebit.workspaceId,
            directImageDebit.userId,
            directImageDebit.amount,
            undefined,
            `Auto-refund: direct image generation failed (${model})`,
          )
          .catch((refundError) => console.error("[generate-image] direct debit refund failed", refundError));
        directImageDebit = null;
      }
      // Handle tier/credit errors
      if (error instanceof TierGuardError) {
        return reply.code(error.statusCode).send(
          applicationErrorResponseSchema.parse({
            error: { code: error.code, message: error.message },
          }),
        );
      }
      if (error instanceof CreditServiceError) {
        return reply.code(error.statusCode).send(
          applicationErrorResponseSchema.parse({
            error: { code: error.code, message: error.message },
          }),
        );
      }

      const message =
        error instanceof Error ? error.message : "Image generation failed.";

      if (message.includes("No provider registered")) {
        return reply.code(400).send(
          applicationErrorResponseSchema.parse({
            error: {
              code: "provider_not_configured",
              message: "Image generation is not available.",
            },
          }),
        );
      }

      return reply.code(502).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "generation_failed",
            message,
          },
        }),
      );
    }
  });

  // ── POST /api/agent/generate-video ──────────────────────────
  app.post("/api/agent/generate-video", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) {
      return reply.code(401).send(
        unauthenticatedErrorResponseSchema.parse({
          error: {
            code: "unauthorized",
            message: "Missing or invalid bearer token.",
          },
        }),
      );
    }

    let payload: z.infer<typeof generateVideoRequestSchema>;
    try {
      payload = generateVideoRequestSchema.parse(request.body);
    } catch {
      return reply.code(400).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "invalid_request",
            message: "Invalid request body.",
          },
        }),
      );
    }

    if (!options.jobService) {
      return reply.code(503).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "service_unavailable",
            message: "Video generation is not available (job service not configured).",
          },
        }),
      );
    }

    const configuredModel = options.localDb
      ? await resolveConfiguredModel(options.localDb, "video", undefined, {
          requiresInputImage: Boolean(payload.inputImages?.length),
          ...(payload.duration != null ? { requiredDuration: payload.duration } : {}),
        })
      : null;
    const registeredModel = getAvailableVideoModels()[0]?.id;
    const model = payload.model ?? configuredModel?.model_id ?? registeredModel;
    if (!model) {
      return reply.code(503).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "service_unavailable",
            message: "当前没有可用的视频模型，请先启用并探测一个视频模型。",
          },
        }),
      );
    }

    const configuredAudioSupport = configuredModel?.supports_audio;
    const registeredAudioSupport = getAvailableVideoModels().find((candidate) => candidate.id === model)?.capabilities.audio;
    if (payload.enableAudio === true && (configuredAudioSupport === false || registeredAudioSupport === false)) {
      return reply.code(422).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "invalid_input",
            message: "The selected video model does not support generated audio.",
          },
        }),
      );
    }

    try {
      // ── Tier guard + credit checks ──
      const viewer = await options.viewerService.ensureViewer(user);
      const workspaceId = viewer.workspace.id;
      payload.resolution = resolveVideoResolution(model, payload.resolution as VideoResolution | undefined);
      let creditsCost = 0;
      if (options.creditService && options.tierGuard) {
        // Top-up credit system: no plan-based restrictions.
        await options.tierGuard.checkModelAccess(model);
        if (payload.resolution) {
          options.tierGuard.checkVideoResolution(
            payload.resolution as VideoResolution,
          );
        }
        await options.tierGuard.checkConcurrency(workspaceId);
        creditsCost = await options.tierGuard.calculateCreditCost(
          model,
          "video_generation",
          {
            ...(payload.duration != null ? { duration: payload.duration } : {}),
            ...(payload.resolution
              ? { resolution: payload.resolution as VideoResolution }
              : {}),
          },
        );
      }

      // ── Create job ──
      const routing = configuredModel
        ? buildMediaRoute({
            intent: {
              mediaType: "video",
              inputImageCount: payload.inputImages?.length ?? 0,
              inputVideo: false,
              enableAudio: payload.enableAudio ?? false,
              ...(payload.duration != null ? { durationSeconds: payload.duration } : {}),
              ...(payload.resolution ? { resolution: payload.resolution } : {}),
              ...(payload.model ? { requestedModel: payload.model } : {}),
              selectionMode: payload.model ? "manual" : "auto",
            },
            selected: configuredModel,
            candidates: [configuredModel.model_id],
          })
        : null;
      const jobPayload = {
        prompt: payload.prompt,
        model,
        ...(routing ? { routing } : {}),
        ...(payload.duration != null ? { duration: payload.duration } : {}),
        ...(payload.resolution ? { resolution: payload.resolution } : {}),
        ...(payload.aspectRatio
          ? { aspect_ratio: payload.aspectRatio === "9:16" || payload.aspectRatio === "3:4" ? "9:16" : "16:9" }
          : {}),
        ...(payload.inputImages?.length ? { input_images: payload.inputImages } : {}),
        enable_audio: payload.enableAudio ?? false,
      };
      if (approvalService && creditsCost > 0) {
        const gate = await approvalService.gate({
          workspaceId,
          userId: user.id,
          jobType: "video_generation",
          model,
          payload: jobPayload,
          estimatedCredits: creditsCost,
          ...(request.headers["x-generation-approval"]
            ? { approvalId: request.headers["x-generation-approval"] as string }
            : {}),
        });
        if (gate.state === "confirmation_required") {
          return reply.code(409).send(approvalRequiredResponse(gate.request));
        }
      }

      const job = await options.jobService.createJob(user, {
        workspaceId,
        jobType: "video_generation",
        payload: jobPayload,
      });

      // ── Deduct credits BEFORE generation ──
      if (options.creditService && creditsCost > 0) {
        try {
          const txId = await options.creditService.deductCredits(
            workspaceId,
            user.id,
            creditsCost,
            job.id,
            "Video generation",
          );
          await options.jobService.setCreditsInfo(job.id, creditsCost, txId);
        } catch (deductError) {
          await options.jobService.cancelJob(user, job.id).catch(() => {});
          throw deductError;
        }
      }

      // ── Poll until terminal state ──
      const POLL_INTERVAL = 3_000;
      const MAX_WAIT = 900_000; // Keep the request aligned with slow upstream video jobs.

      const result = await pollJobUntilDone(
        options.jobService,
        job.id,
        POLL_INTERVAL,
        MAX_WAIT,
      );

      if ("error" in result) {
        return reply.code(502).send(
          applicationErrorResponseSchema.parse({
            error: {
              code: "generation_failed",
              message: result.error,
            },
          }),
        );
      }

      return reply.code(200).send({
        url: result.signed_url,
        assetId: result.asset_id,
        prompt: payload.prompt,
        mimeType: result.mime_type,
        width: result.width,
        height: result.height,
        durationSeconds: result.duration_seconds,
      });
    } catch (error) {
      if (error instanceof TierGuardError) {
        return reply.code(error.statusCode).send(
          applicationErrorResponseSchema.parse({
            error: { code: error.code, message: error.message },
          }),
        );
      }
      if (error instanceof CreditServiceError) {
        return reply.code(error.statusCode).send(
          applicationErrorResponseSchema.parse({
            error: { code: error.code, message: error.message },
          }),
        );
      }
      if (error instanceof JobServiceError) {
        return reply.code(error.statusCode).send(
          applicationErrorResponseSchema.parse({
            error: { code: error.code, message: error.message },
          }),
        );
      }
      if (error instanceof GenerationApprovalError) {
        return reply.code(error.statusCode).send({
          ok: false,
          error: { code: error.code, message: error.message },
        });
      }

      const message =
        error instanceof Error ? error.message : "Video generation failed.";

      return reply.code(502).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "generation_failed",
            message,
          },
        }),
      );
    }
  });
}

// ── Job polling helper ──────────────────────────────────────

type VideoJobResult = {
  signed_url: string;
  asset_id: string;
  width: number;
  height: number;
  duration_seconds: number;
  mime_type: string;
};

type PollResult = VideoJobResult | { error: string };

async function pollJobUntilDone(
  jobService: JobService,
  jobId: string,
  pollInterval: number,
  maxWait: number,
): Promise<PollResult> {
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await delay(pollInterval);

    const current = await jobService.getJobAdmin(jobId);

    if (current.status === "succeeded" && current.result) {
      const r = current.result as Record<string, unknown>;
      return {
        signed_url: (r.signed_url as string) ?? "",
        asset_id: (r.asset_id as string) ?? "",
        width: (r.width as number) ?? 0,
        height: (r.height as number) ?? 0,
        duration_seconds: (r.duration_seconds as number) ?? 0,
        mime_type: (r.mime_type as string) ?? "video/mp4",
      };
    }

    if (current.status === "dead_letter" || current.status === "canceled") {
      return { error: current.error_message ?? `Job ${current.status}` };
    }

    if (
      current.status === "failed" &&
      current.attempt_count >= current.max_attempts
    ) {
      return {
        error: current.error_message ?? "Job failed after max retries",
      };
    }
  }

  return { error: `Job timed out after ${maxWait / 1000}s` };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function needsPublicReferenceUrl(model: string): boolean {
  return model.includes("/") || /minimax-h3/i.test(model);
}

function requestOrigin(request: { protocol?: string; headers: Record<string, string | string[] | undefined> }): string | undefined {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const forwardedHost = request.headers["x-forwarded-host"];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ?? request.protocol ?? "https";
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? request.headers.host;
  return host ? `${proto}://${host}` : undefined;
}

// ── Image download + upload helper ──────────────────────────

async function downloadAndUpload(
  sourceUrl: string,
  mimeType: string,
  prompt: string,
  user: AuthenticatedUser,
  deps: { uploadService: UploadService; viewerService: ViewerService },
): Promise<{ signedUrl: string; assetId: string }> {
  const response = sourceUrl.startsWith("data:")
    ? null
    : await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
  let buffer: Buffer;
  if (response === null) {
    const match = sourceUrl.match(/^data:image\/[^;]+;base64,(.+)$/i);
    const encoded = match?.[1];
    if (!encoded) throw new Error("Generated image returned an invalid data URI");
    buffer = Buffer.from(encoded, "base64");
  } else {
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 25 * 1024 * 1024) throw new Error("Generated image exceeds the 25 MB limit");
    if (!response.ok) {
      throw new Error(`Failed to download generated image: ${response.status}`);
    }
    buffer = Buffer.from(await response.arrayBuffer());
  }
  if (buffer.length > 25 * 1024 * 1024) throw new Error("Generated image exceeds the 25 MB limit");

  const ext = mimeType === "image/webp" ? "webp" : mimeType === "image/jpeg" ? "jpg" : "png";
  const slug = prompt.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fileName = `gen-${slug}-${Date.now()}.${ext}`;

  const viewer = await deps.viewerService.ensureViewer(user);

  const result = await deps.uploadService.uploadFile(user, {
    bucket: "project-assets",
    fileName,
    fileBuffer: buffer,
    mimeType,
    workspaceId: viewer.workspace.id,
  });

  return { signedUrl: result.url, assetId: result.asset.id };
}
