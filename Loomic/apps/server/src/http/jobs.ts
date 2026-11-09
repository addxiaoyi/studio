
// @credits-system — Job creation routes with credit balance checks and tier enforcement
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";

import type { BackgroundJobStatus, BackgroundJobType, ImageQualityLevel, VideoResolution } from "@helstera/shared";
import {
  applicationErrorResponseSchemaLoose,
  CONFIGURED_PRICE_MULTIPLIER,
  TOKEN_BILLING_RESERVE_CREDITS,
  createImageJobRequestSchema,
  createVideoJobRequestSchema,
  getPlanConfig,
  resolveVideoResolution,
  jobListResponseSchema,
  jobResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@helstera/shared";

import {
  JobServiceError,
  type JobService,
} from "../features/jobs/job-service.js";
import {
  CreditServiceError,
  type CreditService,
} from "../features/credits/credit-service.js";
import {
  TierGuardError,
  type TierGuard,
} from "../features/credits/tier-guard.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { RequestAuthenticator } from "../auth/types.js";
import type { StorageProvider } from "../storage/index.js";
import { syncGenerationJob } from "../features/jobs/sync-service.js";
import { cancelUnstartedJob } from "../features/jobs/cancel-unstarted-job.js";
import { resolveConfiguredModel } from "./model-availability.js";
import { isRemovedImageModelId } from "../generation/removed-models.js";
import { approvalRequiredResponse } from "./generation-approvals.js";
import { buildMediaRoute } from "../features/media/media-routing.js";
import { assertConnectorEnabled, ConnectorDisabledError } from "../features/agent-goals/connector-gate.js";
import {
  createGenerationApprovalService,
  GenerationApprovalError,
} from "../features/generation/generation-approval-service.js";

export async function registerJobRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    creditService?: CreditService;
    jobService: JobService;
    tierGuard?: TierGuard;
    viewerService: ViewerService;
    localDb?: Pool;
    storage?: StorageProvider;
  },
) {
  const approvalService = options.localDb
    ? createGenerationApprovalService(options.localDb)
    : undefined;
  // POST /api/jobs/image-generation — create image generation job
  app.post("/api/jobs/image-generation", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const payload = createImageJobRequestSchema.parse(request.body);
      if (payload.purpose === "try-on" && (!approvalService || !options.tierGuard || !options.creditService)) {
        return reply.code(503).send({ error: { code: "generation_confirmation_unavailable", message: "试穿费用确认暂不可用，请稍后重试。" } });
      }
      if (payload.purpose === "try-on" && (payload.input_asset_ids?.length !== 2 || payload.input_images?.length)) {
        return reply.code(400).send({ error: { code: "invalid_input", message: "试穿需要人物与服装两张已上传的私有参考图。" } });
      }
      if (payload.model && isRemovedImageModelId(payload.model)) {
        return reply.code(410).send({ error: { code: "model_retired", message: "The selected image model has been retired." } });
      }
      const idempotencyKey = typeof request.headers["idempotency-key"] === "string" ? request.headers["idempotency-key"].trim().slice(0, 160) : undefined;
      const viewer = await options.viewerService.ensureViewer(user);
      if (options.localDb) await assertConnectorEnabled(options.localDb, viewer.workspace.id, user.id, "media-generation");
      if (options.localDb && idempotencyKey) {
        const existing = await options.localDb.query("select id from background_jobs where created_by=$1 and idempotency_key=$2", [user.id, idempotencyKey]);
        if (existing.rows[0]) return reply.code(200).send(jobResponseSchema.parse({ job: await options.jobService.getJob(user, existing.rows[0].id) }));
      }

      // Credit checks (skip if credit system not configured)
      const requestedModel = payload.model ?? "black-forest-labs/flux-kontext-pro";
      const routedModel = options.localDb
        ? await resolveConfiguredModel(options.localDb, "image", requestedModel, {
            requiresInputImage: Boolean(payload.input_asset_ids?.length || payload.input_images?.length),
            strictRequested: Boolean(payload.model),
            allowUnverified: Boolean(payload.model),
            excludeModelIds: [
                "nano-banana-2-1k",
              "nano-banana-2-2k",
            ],
          })
        : null;
      const model = routedModel?.model_id ?? requestedModel;
      if (options.localDb && !routedModel) {
        return reply.code(503).send({
          error: {
            code: "no_image_model",
            message: "当前没有可用的图片模型，请稍后重试。",
          },
        });
      }
      let creditsCost = 0;
      const routing = routedModel
        ? buildMediaRoute({
            intent: {
              mediaType: "image",
              inputImageCount: payload.input_images?.length ?? payload.input_asset_ids?.length ?? 0,
              inputVideo: false,
              enableAudio: false,
              ...(payload.model ? { requestedModel: payload.model } : {}),
              selectionMode: payload.model ? "manual" : "auto",
            },
            selected: routedModel,
            candidates: [routedModel.model_id],
          })
        : null;

      if (options.creditService && options.tierGuard) {
        // Top-up credit system: no plan-based restrictions.
        const quality: ImageQualityLevel = "hd";
        await options.tierGuard.checkModelAccess(model);
        await options.tierGuard.checkConcurrency(viewer.workspace.id);
        if (payload.purpose === "try-on" && routedModel) {
          // Quote the selected healthy route, not another provider sharing this model ID.
          creditsCost = routedModel.billing_unit === "per_million_tokens"
            ? TOKEN_BILLING_RESERVE_CREDITS
            : Number(routedModel.price_credits) * CONFIGURED_PRICE_MULTIPLIER;
          if (!Number.isFinite(creditsCost) || creditsCost < 0) {
            return reply.code(503).send({ error: { code: "model_price_unavailable", message: "所选试穿模型尚未配置有效价格，请刷新模型目录。" } });
          }
        } else {
          creditsCost = await options.tierGuard.calculateCreditCost(model, "image_generation", { quality });
        }
      }

      const jobPayload = {
        ...(payload.purpose ? { purpose: payload.purpose } : {}),
        prompt: payload.prompt,
        model,
        ...(routing ? { routing } : {}),
        ...(payload.aspect_ratio !== undefined
          ? { aspect_ratio: payload.aspect_ratio }
          : {}),
        ...(payload.input_images !== undefined ? { input_images: payload.input_images } : {}),
        ...(payload.input_asset_ids !== undefined ? { input_asset_ids: payload.input_asset_ids } : {}),
      };
      let approvalId: string | undefined;
      if (approvalService && (creditsCost > 0 || payload.purpose === "try-on")) {
        const gate = await approvalService.gate({
          workspaceId: viewer.workspace.id,
          userId: user.id,
          jobType: "image_generation",
          model,
          payload: jobPayload,
          estimatedCredits: creditsCost,
          forceConfirmation: payload.purpose === "try-on",
          context: {
            ...(payload.canvas_id ? { canvasId: payload.canvas_id } : {}),
            ...(payload.session_id ? { sessionId: payload.session_id } : {}),
            ...(payload.thread_id ? { threadId: payload.thread_id } : {}),
            ...(payload.project_id ? { projectId: payload.project_id } : {}),
          },
          ...(request.headers["x-generation-approval"]
            ? { approvalId: request.headers["x-generation-approval"] as string }
            : {}),
        });
        if (gate.state === "confirmation_required") {
          return reply.code(409).send(approvalRequiredResponse(gate.request));
        }
        approvalId = gate.approvalId;
      }

      const job = await options.jobService.createJob(user, {
        workspaceId: viewer.workspace.id,
        ...(payload.project_id !== undefined
          ? { projectId: payload.project_id }
          : {}),
        ...(payload.canvas_id !== undefined
          ? { canvasId: payload.canvas_id }
          : {}),
        ...(payload.session_id !== undefined
          ? { sessionId: payload.session_id }
          : {}),
        ...(payload.thread_id !== undefined
          ? { threadId: payload.thread_id }
          : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        jobType: "image_generation",
        payload: jobPayload,
      });

      if (job.reused && !job.reactivated) {
        if (approvalId) {
          const attachedJobId = await approvalService!.attachJob(approvalId, job.id);
          if (!attachedJobId || attachedJobId !== job.id) {
            throw new GenerationApprovalError("generation_approval_invalid", "This confirmation is already linked to another job.");
          }
        }
        return reply.code(200).send(jobResponseSchema.parse({ job }));
      }

      // Deduct credits after job creation (we need the job ID for tracking)
      if (options.creditService && creditsCost > 0) {
        try {
          const txId = await options.creditService.deductCredits(
            viewer.workspace.id,
            user.id,
            creditsCost,
            job.id,
            "Image generation",
          );
          await options.jobService.setCreditsInfo(job.id, creditsCost, txId);
        } catch (deductError) {
          // Deduction failed — cancel the job and re-throw
          await options.jobService.cancelJob(user, job.id).catch(() => {});
          throw deductError;
        }
      }
      if (approvalId) {
        const attachedJobId = await approvalService!.attachJob(approvalId, job.id);
        if (!attachedJobId || attachedJobId !== job.id) {
          throw new GenerationApprovalError("generation_approval_invalid", "This confirmation is already linked to another job.");
        }
      }

      return reply.code(201).send(jobResponseSchema.parse({ job }));
    } catch (error) {
      if (isZodError(error)) {
        return reply
          .code(400)
          .send({ issues: error.issues, message: "Invalid request body" });
      }
      return sendJobError(error, reply, "job_create_failed");
    }
  });

  // POST /api/jobs/video-generation — create video generation job
  app.post("/api/jobs/video-generation", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const payload = createVideoJobRequestSchema.parse(request.body);
      const requireConfirmation=request.headers["x-generation-confirmation"]==="required";
      if(requireConfirmation&&!approvalService)return reply.code(503).send({error:{code:"generation_confirmation_unavailable",message:"素材生成费用确认暂不可用，请稍后重试。"}});
      const idempotencyKey = typeof request.headers["idempotency-key"] === "string" ? request.headers["idempotency-key"].trim().slice(0, 160) : undefined;
      const viewer = await options.viewerService.ensureViewer(user);
      if (options.localDb) await assertConnectorEnabled(options.localDb, viewer.workspace.id, user.id, "media-generation");
      if (options.localDb && idempotencyKey) {
        const existing = await options.localDb.query("select id from background_jobs where created_by=$1 and idempotency_key=$2", [user.id, idempotencyKey]);
        if (existing.rows[0]) return reply.code(200).send(jobResponseSchema.parse({ job: await options.jobService.getJob(user, existing.rows[0].id) }));
      }

      // Credit checks (skip if credit system not configured)
      const resolvedModel = options.localDb
          ? await resolveConfiguredModel(options.localDb, "video", payload.model, {
            requiresInputImage: Boolean(payload.input_images?.length || payload.input_asset_ids?.length),
            strictRequested: Boolean(payload.model),
            allowUnverified: Boolean(payload.model),
            ...(payload.duration != null ? { requiredDuration: payload.duration } : {}),
          })
        : null;
      if (options.localDb && !resolvedModel) {
        return reply.code(422).send({
          error: {
            code: "video_model_unavailable",
            message: payload.model
              ? "所选视频模型当前不可用，请刷新模型列表后重试。"
              : "当前没有可用且已配置计费的视频模型。",
          },
        });
      }
      if (payload.enable_audio === true && resolvedModel?.supports_audio === false) {
        return reply.code(422).send({
          error: {
            code: "invalid_input",
            message: "The selected video model does not support generated audio.",
          },
        });
      }
      const model = resolvedModel?.model_id ?? payload.model ?? "wan-video/wan-2.6";
      payload.resolution = resolveVideoResolution(model, payload.resolution as VideoResolution | undefined);
      const routing = resolvedModel
        ? buildMediaRoute({
            intent: {
              mediaType: "video",
              inputImageCount: payload.input_images?.length ?? payload.input_asset_ids?.length ?? 0,
              inputVideo: Boolean(payload.input_video),
              enableAudio: payload.enable_audio ?? false,
              ...(payload.duration != null ? { durationSeconds: payload.duration } : {}),
              ...(payload.resolution ? { resolution: payload.resolution } : {}),
              ...(payload.model ? { requestedModel: payload.model } : {}),
              selectionMode: payload.model ? "manual" : "auto",
            },
            selected: resolvedModel,
            candidates: [resolvedModel.model_id],
          })
        : null;
      let creditsCost = 0;

      if (options.creditService && options.tierGuard) {
        // Top-up credit system: no plan-based restrictions.
        await options.tierGuard.checkModelAccess(model);
        await options.tierGuard.checkConcurrency(viewer.workspace.id);
        creditsCost = await options.tierGuard.calculateCreditCost(
          model,
          "video_generation",
          {
            ...(payload.duration != null ? { duration: payload.duration } : {}),
            ...(payload.resolution ? { resolution: payload.resolution as VideoResolution } : {}),
          },
        );
      }

      const jobPayload = {
        prompt: payload.prompt,
        model,
        ...(routing ? { routing } : {}),
        ...(payload.duration !== undefined ? { duration: payload.duration } : {}),
        ...(payload.resolution !== undefined ? { resolution: payload.resolution } : {}),
        ...(payload.aspect_ratio !== undefined ? { aspect_ratio: payload.aspect_ratio } : {}),
        ...(payload.input_images !== undefined ? { input_images: payload.input_images } : {}),
        ...(payload.input_asset_ids !== undefined ? { input_asset_ids: payload.input_asset_ids } : {}),
        ...(payload.input_video !== undefined ? { input_video: payload.input_video } : {}),
        enable_audio: payload.enable_audio ?? false,
      };
      let approvalId: string | undefined;
      if (approvalService && (creditsCost > 0 || requireConfirmation)) {
        const gate = await approvalService.gate({
          workspaceId: viewer.workspace.id,
          userId: user.id,
          jobType: "video_generation",
          forceConfirmation:requireConfirmation,
          model,
          payload: jobPayload,
          estimatedCredits: creditsCost,
          context: {
            ...(payload.canvas_id ? { canvasId: payload.canvas_id } : {}),
            ...(payload.session_id ? { sessionId: payload.session_id } : {}),
            ...(payload.thread_id ? { threadId: payload.thread_id } : {}),
            ...(payload.project_id ? { projectId: payload.project_id } : {}),
          },
          ...(request.headers["x-generation-approval"]
            ? { approvalId: request.headers["x-generation-approval"] as string }
            : {}),
        });
        if (gate.state === "confirmation_required") {
          return reply.code(409).send(approvalRequiredResponse(gate.request));
        }
        approvalId = gate.approvalId;
      }

      const job = await options.jobService.createJob(user, {
        workspaceId: viewer.workspace.id,
        ...(payload.project_id !== undefined
          ? { projectId: payload.project_id }
          : {}),
        ...(payload.canvas_id !== undefined
          ? { canvasId: payload.canvas_id }
          : {}),
        ...(payload.session_id !== undefined
          ? { sessionId: payload.session_id }
          : {}),
        ...(payload.thread_id !== undefined
          ? { threadId: payload.thread_id }
          : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        jobType: "video_generation",
        payload: jobPayload,
      });

      if (job.reused && !job.reactivated) {
        if (approvalId) {
          const attachedJobId = await approvalService!.attachJob(approvalId, job.id);
          if (!attachedJobId || attachedJobId !== job.id) {
            throw new GenerationApprovalError("generation_approval_invalid", "This confirmation is already linked to another job.");
          }
        }
        return reply.code(200).send(jobResponseSchema.parse({ job }));
      }

      // Deduct credits after job creation
      if (options.creditService && creditsCost > 0) {
        try {
          const txId = await options.creditService.deductCredits(
            viewer.workspace.id,
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
      if (approvalId) {
        const attachedJobId = await approvalService!.attachJob(approvalId, job.id);
        if (!attachedJobId || attachedJobId !== job.id) {
          throw new GenerationApprovalError("generation_approval_invalid", "This confirmation is already linked to another job.");
        }
      }

      return reply.code(201).send(jobResponseSchema.parse({ job }));
    } catch (error) {
      if (isZodError(error)) {
        return reply
          .code(400)
          .send({ issues: error.issues, message: "Invalid request body" });
      }
      return sendJobError(error, reply, "job_create_failed");
    }
  });

  // GET /api/jobs/:jobId — get job status
  app.get("/api/jobs/:jobId/timeline", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);
      const { jobId } = request.params as { jobId: string };
      const job = await options.jobService.getJob(user, jobId);
      if (!options.localDb) return reply.send({ jobId, events: [] });
      const approval = await options.localDb.query<{ id: string; status: string; approved_at: string | null; consumed_at: string | null; expires_at: string }>("select id, status, approved_at, consumed_at, expires_at from generation_approvals where job_id = $1 order by created_at desc limit 1", [jobId]);
      const assets = await options.localDb.query<{ id: string; created_at: string }>("select id, created_at from asset_objects where id = $1", [(job.result as Record<string, unknown> | null)?.asset_id ?? null]);
      const canvas = await options.localDb.query<{ id: string }>("select id from canvases where content->'elements' @> $1::jsonb", [JSON.stringify([{ customData: { jobId } }])]);
      const result = (job.result ?? {}) as Record<string, unknown>;
      const providerTaskId = firstString(result, ["provider_task_id", "providerTaskId", "task_id", "taskId"]) ?? firstString((job.payload ?? {}) as Record<string, unknown>, ["provider_task_id", "providerTaskId", "task_id", "taskId"]);
      const events: Array<{ key: string; label: string; status: "done" | "active" | "failed" | "pending"; at?: string; id?: string; detail?: string }> = [];
      events.push({ key: "request", label: "Request received", status: "done", at: job.created_at });
      if (approval.rows[0]) events.push({ key: "approval", label: "Credit approval", status: approval.rows[0].status === "rejected" || approval.rows[0].status === "expired" ? "failed" : approval.rows[0].consumed_at ? "done" : "active", at: approval.rows[0].approved_at ?? approval.rows[0].expires_at, id: approval.rows[0].id, detail: approval.rows[0].status });
      events.push({ key: "job", label: "Job queue", status: job.status === "failed" || job.status === "dead_letter" || job.status === "canceled" ? "failed" : job.status === "queued" ? "active" : "done", at: job.started_at ?? job.created_at, id: job.id, detail: job.status });
      events.push({ key: "provider", label: "Provider task", status: job.status === "succeeded" ? "done" : job.status === "failed" || job.status === "dead_letter" ? "failed" : "active", ...(providerTaskId ? { id: providerTaskId } : {}), detail: providerTaskId ? "providerTaskId recorded" : "Waiting for Provider task ID" });
      events.push({ key: "asset", label: "Asset saved", status: assets.rows[0] ? "done" : job.status === "failed" || job.status === "dead_letter" ? "failed" : "pending", ...(assets.rows[0]?.created_at ? { at: assets.rows[0].created_at } : {}), ...(assets.rows[0]?.id ? { id: assets.rows[0].id } : {}) });
      events.push({ key: "canvas", label: "Canvas writeback", status: canvas.rows[0] ? "done" : job.status === "succeeded" ? "failed" : "pending", ...(canvas.rows[0]?.id ? { id: canvas.rows[0].id } : {}), ...(canvas.rows[0] ? { detail: "Canvas element found by jobId" } : {}) });
      return reply.code(200).send({ jobId, events });
    } catch (error) {
      return sendJobError(error, reply, "job_query_failed");
    }
  });

  app.post("/api/jobs/:jobId/sync", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);
      if (!options.localDb || !options.storage) return reply.code(503).send({ error: { code: "job_sync_unavailable", message: "Job synchronization is unavailable." } });
      const { jobId } = request.params as { jobId: string };
      const currentJob = await options.jobService.getJob(user, jobId);
      if (currentJob.status === "sync_failed" && await options.jobService.retryProviderCheckpoint(jobId)) {
        const job = await options.jobService.getJob(user, jobId);
        return reply.code(202).send({ job, sync: { state: "queued_from_provider_checkpoint" } });
      }
      const result = await syncGenerationJob(options.localDb, options.storage, jobId, { force: true });
      const job = await options.jobService.getJob(user, jobId);
      return reply.code(200).send({ job, sync: result });
    } catch (error) {
      return sendJobError(error, reply, "job_query_failed");
    }
  });

  app.get("/api/jobs/:jobId", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const { jobId } = request.params as { jobId: string };
      const job = await options.jobService.getJob(user, jobId);

      return reply.code(200).send(jobResponseSchema.parse({ job }));
    } catch (error) {
      return sendJobError(error, reply, "job_query_failed");
    }
  });

  // GET /api/jobs — list jobs
  app.get("/api/jobs", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const query = request.query as { status?: string; job_type?: string };
      const filters: { status?: BackgroundJobStatus; jobType?: BackgroundJobType } = {};
      if (query.status) filters.status = query.status as BackgroundJobStatus;
      if (query.job_type) filters.jobType = query.job_type as BackgroundJobType;
      const jobs = await options.jobService.listJobs(user, filters);

      return reply.code(200).send(jobListResponseSchema.parse({ jobs }));
    } catch (error) {
      return sendJobError(error, reply, "job_query_failed");
    }
  });

  // POST /api/jobs/:jobId/cancel — cancel job
  app.post("/api/jobs/:jobId/cancel", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);

      const { jobId } = request.params as { jobId: string };
      const currentJob = await options.jobService.getJob(user, jobId);
      if (options.localDb && options.creditService && ["image_generation", "video_generation"].includes(currentJob.job_type)) {
        const billing = await cancelUnstartedJob(options.localDb, jobId, user.id);
        if (billing.amount > 0) await options.creditService.refundCredits(billing.workspaceId, user.id, billing.amount, jobId, "任务开始前取消，释放预占积分");
        const job = await options.jobService.getJob(user, jobId);
        return reply.code(200).send(jobResponseSchema.parse({ job }));
      }
      const job = await options.jobService.cancelJob(user, jobId);

      return reply.code(200).send(jobResponseSchema.parse({ job }));
    } catch (error) {
      return sendJobError(error, reply, "job_cancel_failed");
    }
  });
}

function sendUnauthenticated(reply: FastifyReply) {
  return reply.code(401).send(
    unauthenticatedErrorResponseSchema.parse({
      error: {
        code: "unauthorized",
        message: "Missing or invalid bearer token.",
      },
    }),
  );
}

type JobErrorFallbackCode =
  | "job_not_found"
  | "job_create_failed"
  | "job_query_failed"
  | "job_cancel_failed";

function sendJobError(
  error: unknown,
  reply: FastifyReply,
  fallbackCode: JobErrorFallbackCode,
) {
  if (error instanceof ConnectorDisabledError) {
    return reply.code(403).send({ error: { code: "connector_disabled", message: error.message } });
  }
  if (error instanceof Error && "code" in error && error.code === "invalid_input") {
    return reply.code(422).send({ error: { code: "invalid_input", message: error.message } });
  }
  if (error instanceof JobServiceError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchemaLoose.parse({
        error: { code: error.code, message: error.message },
      }),
    );
  }
  if (error instanceof TierGuardError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchemaLoose.parse({
        error: { code: error.code, message: error.message },
      }),
    );
  }
  if (error instanceof CreditServiceError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchemaLoose.parse({
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
  return reply.code(500).send(
    applicationErrorResponseSchemaLoose.parse({
      error: {
        code: fallbackCode,
        message: "An unexpected error occurred.",
      },
    }),
  );
}

function isZodError(
  error: unknown,
): error is { issues: unknown[]; name: string } {
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    "issues" in error &&
    Array.isArray(error.issues)
  );
}

function firstString(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }
  return undefined;
}
