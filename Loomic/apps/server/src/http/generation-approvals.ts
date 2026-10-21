import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";

import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import {
  GenerationApprovalError,
  type GenerationApprovalRequest,
} from "../features/generation/generation-approval-service.js";
import { createGenerationApprovalService } from "../features/generation/generation-approval-service.js";
import type { JobService } from "../features/jobs/job-service.js";
import type { CreditService } from "../features/credits/credit-service.js";

export function registerGenerationApprovalRoutes(
  app: FastifyInstance,
  options: { auth: RequestAuthenticator; viewerService: ViewerService; db: Pool; jobService?: JobService; creditService?: CreditService },
) {
  const approvals = createGenerationApprovalService(options.db);

  app.post("/api/generation-approvals/pending/confirm", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return unauthorized(reply);
      const viewer = await options.viewerService.ensureViewer(user);
      const { canvasId } = request.body as { canvasId?: string };
      if (!canvasId) return reply.code(400).send({ ok: false, error: { code: "invalid_input", message: "canvasId is required." } });
      const { rows } = await options.db.query<{ id: string }>(
        `select id from generation_approvals
          where workspace_id = $1 and user_id = $2 and status = 'pending'
            and expires_at > now() and context->>'canvasId' = $3
          order by created_at desc limit 1`,
        [viewer.workspace.id, user.id, canvasId],
      );
      const approvalId = rows[0]?.id;
      if (!approvalId) {
        return reply.send({ ok: true, data: null });
      }
      const approval = await approvals.approve({ approvalId, workspaceId: viewer.workspace.id, userId: user.id });
      if (!options.jobService) return reply.send({ ok: true, data: { state: "approved", approval } });
      const job = await options.jobService.createJob(user, {
        workspaceId: viewer.workspace.id,
        ...(approval.context?.canvasId ? { canvasId: approval.context.canvasId } : {}),
        ...(approval.context?.sessionId ? { sessionId: approval.context.sessionId } : {}),
        ...(approval.context?.threadId ? { threadId: approval.context.threadId } : {}),
        jobType: approval.jobType,
        idempotencyKey: `approval:${approvalId}`,
        payload: approval.parameters,
      });
      if (options.creditService && approval.estimatedCredits > 0) {
        const txId = await options.creditService.deductCredits(viewer.workspace.id, user.id, approval.estimatedCredits, job.id, `${approval.jobType}: ${approval.model}`);
        await options.jobService.setCreditsInfo(job.id, approval.estimatedCredits, txId);
      }
      await approvals.attachJob(approvalId, job.id);
      if (approval.context?.websiteCaptureTaskId) {
        await options.db.query("update website_capture_tasks set promo_status='queued', promo_job_id=$2, updated_at=now() where id=$1 and workspace_id=$3", [approval.context.websiteCaptureTaskId, job.id, viewer.workspace.id]);
      }
      return reply.send({ ok: true, data: { state: "approved", approval, jobId: job.id } });
    } catch (error) {
      return approvalError(error, reply);
    }
  });

  app.get("/api/generation-approvals/pending", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return unauthorized(reply);
      const viewer = await options.viewerService.ensureViewer(user);
      const { canvasId } = request.query as { canvasId?: string };
      if (!canvasId) return reply.code(400).send({ ok: false, error: { code: "invalid_input", message: "canvasId is required." } });
      const { rows } = await options.db.query<{
        id: string;
        job_type: "image_generation" | "video_generation";
        model: string;
        estimated_credits: number;
        expires_at: string;
        payload: { duration?: number; resolution?: string; input_images?: string[] };
      }>(
        `select id, job_type, model, estimated_credits, expires_at, payload
           from generation_approvals
          where workspace_id = $1 and user_id = $2 and status = 'pending'
            and expires_at > now() and context->>'canvasId' = $3
          order by created_at desc limit 1`,
        [viewer.workspace.id, user.id, canvasId],
      );
      const approval = rows[0];
      if (!approval) return reply.send({ ok: true, data: null });
      return reply.send({
        ok: true,
        data: {
          state: "confirmation_required",
          approvalId: approval.id,
          jobType: approval.job_type,
          model: approval.model,
          estimatedCredits: Number(approval.estimated_credits),
          expiresAt: approval.expires_at,
          hasReferenceImage: Array.isArray(approval.payload?.input_images) && approval.payload.input_images.length > 0,
          ...(typeof approval.payload?.duration === "number" ? { duration: approval.payload.duration } : {}),
          ...(typeof approval.payload?.resolution === "string" ? { resolution: approval.payload.resolution } : {}),
        },
      });
    } catch (error) {
      return approvalError(error, reply);
    }
  });

  app.get("/api/generation-approvals/latest", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return unauthorized(reply);
      const viewer = await options.viewerService.ensureViewer(user);
      const { canvasId } = request.query as { canvasId?: string };
      if (!canvasId) return reply.code(400).send({ ok: false, error: { code: "invalid_input", message: "canvasId is required." } });
      const { rows } = await options.db.query<{
        id: string;
        job_type: "image_generation" | "video_generation";
        model: string;
        estimated_credits: number;
        status: string;
        job_id: string | null;
        job_status: string | null;
        job_error_message: string | null;
        job_updated_at: string | null;
      }>(
        `select ga.id, ga.job_type, ga.model, ga.estimated_credits, ga.status,
                ga.job_id, bj.status as job_status, bj.error_message as job_error_message,
                bj.updated_at as job_updated_at
           from generation_approvals ga
           left join background_jobs bj on bj.id = ga.job_id
          where ga.workspace_id = $1 and ga.user_id = $2 and ga.context->>'canvasId' = $3
          order by coalesce(ga.approved_at, ga.created_at) desc limit 1`,
        [viewer.workspace.id, user.id, canvasId],
      );
      const latest = rows[0];
      if (!latest) return reply.send({ ok: true, data: null });
      return reply.send({
        ok: true,
        data: {
          approvalId: latest.id,
          jobType: latest.job_type,
          model: latest.model,
          estimatedCredits: Number(latest.estimated_credits),
          approvalStatus: latest.status,
          ...(latest.job_id ? { jobId: latest.job_id } : {}),
          ...(latest.job_status ? { jobStatus: latest.job_status } : {}),
          ...(latest.job_error_message ? { error: latest.job_error_message } : {}),
          ...(latest.job_updated_at ? { updatedAt: latest.job_updated_at } : {}),
        },
      });
    } catch (error) {
      return approvalError(error, reply);
    }
  });

  app.get("/api/generation-approvals/:approvalId/status", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return unauthorized(reply);
      const viewer = await options.viewerService.ensureViewer(user);
      const { approvalId } = request.params as { approvalId: string };
      const { rows } = await options.db.query<{
        id: string;
        job_type: "image_generation" | "video_generation";
        model: string;
        estimated_credits: number;
        expires_at: string;
        status: string;
        job_id: string | null;
        job_status: string | null;
        job_error_code: string | null;
        job_error_message: string | null;
        job_updated_at: string | null;
      }>(
        `select ga.id, ga.job_type, ga.model, ga.estimated_credits, ga.expires_at, ga.status,
                ga.job_id, bj.status as job_status, bj.error_code as job_error_code,
                bj.error_message as job_error_message, bj.updated_at as job_updated_at
           from generation_approvals ga
           left join background_jobs bj on bj.id = ga.job_id
          where ga.id = $1 and ga.workspace_id = $2 and ga.user_id = $3
          limit 1`,
        [approvalId, viewer.workspace.id, user.id],
      );
      const row = rows[0];
      if (!row) return reply.code(404).send({ ok: false, error: { code: "generation_approval_not_found", message: "Generation approval was not found." } });
      return reply.send({
        ok: true,
        data: {
          approvalId: row.id,
          jobType: row.job_type,
          model: row.model,
          estimatedCredits: Number(row.estimated_credits),
          expiresAt: row.expires_at,
          approvalStatus: row.status,
          ...(row.job_id ? { jobId: row.job_id } : {}),
          ...(row.job_status ? { jobStatus: row.job_status } : {}),
          ...(row.job_error_code ? { errorCode: row.job_error_code } : {}),
          ...(row.job_error_message ? { error: row.job_error_message } : {}),
          ...(row.job_updated_at ? { updatedAt: row.job_updated_at } : {}),
        },
      });
    } catch (error) {
      return approvalError(error, reply);
    }
  });

  app.post("/api/generation-approvals/:approvalId/confirm", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return unauthorized(reply);
      const viewer = await options.viewerService.ensureViewer(user);
      const { approvalId } = request.params as { approvalId: string };
      const approval = await approvals.approve({ approvalId, workspaceId: viewer.workspace.id, userId: user.id });
      if (approval.jobId) return reply.code(200).send({ ok: true, data: { state: "approved", approval, jobId: approval.jobId } });
      if (!options.jobService) return reply.code(200).send({ ok: true, data: { state: "approved", approval } });
      const job = await options.jobService.createJob(user, {
        workspaceId: viewer.workspace.id,
        ...(approval.context?.canvasId ? { canvasId: approval.context.canvasId } : {}),
        ...(approval.context?.sessionId ? { sessionId: approval.context.sessionId } : {}),
        ...(approval.context?.threadId ? { threadId: approval.context.threadId } : {}),
        ...(approval.context?.projectId ? { projectId: approval.context.projectId } : {}),
        idempotencyKey: `approval:${approvalId}`,
        jobType: approval.jobType,
        payload: approval.parameters,
      });
      if (options.creditService && approval.estimatedCredits > 0) {
        try {
          const txId = await options.creditService.deductCredits(viewer.workspace.id, user.id, approval.estimatedCredits, job.id, `${approval.jobType}: ${approval.model}`);
          await options.jobService.setCreditsInfo(job.id, approval.estimatedCredits, txId);
        } catch (error) {
          await options.jobService.cancelJob(user, job.id).catch(() => undefined);
          throw error;
        }
      }
      const attachedJobId = await approvals.attachJob(approvalId, job.id);
      if (!attachedJobId) throw new GenerationApprovalError("generation_approval_invalid", "The approved job could not be linked to its confirmation.");
      if (attachedJobId !== job.id) throw new GenerationApprovalError("generation_approval_invalid", "This confirmation is already linked to another job.");
      if (approval.context?.websiteCaptureTaskId) {
        await options.db.query("update website_capture_tasks set promo_status='queued', promo_job_id=$2, updated_at=now() where id=$1 and workspace_id=$3", [approval.context.websiteCaptureTaskId, job.id, viewer.workspace.id]);
      }
      return reply.code(200).send({ ok: true, data: { state: "approved", approval, jobId: job.id } });
    } catch (error) {
      return approvalError(error, reply);
    }
  });

  app.post("/api/generation-approvals/:approvalId/cancel", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return unauthorized(reply);
      const viewer = await options.viewerService.ensureViewer(user);
      const { approvalId } = request.params as { approvalId: string };
      const existing = await options.db.query<{ context: { websiteCaptureTaskId?: string } | null }>("select context from generation_approvals where id=$1 and workspace_id=$2 and user_id=$3", [approvalId, viewer.workspace.id, user.id]);
      await approvals.reject({ approvalId, workspaceId: viewer.workspace.id, userId: user.id });
      const websiteTaskId = existing.rows[0]?.context?.websiteCaptureTaskId;
      if (websiteTaskId) await options.db.query("update website_capture_tasks set promo_status='rejected', promo_error='用户取消了宣传成片确认', updated_at=now() where id=$1 and workspace_id=$2", [websiteTaskId, viewer.workspace.id]);
      return reply.code(200).send({ ok: true, data: { state: "rejected" } });
    } catch (error) {
      return approvalError(error, reply);
    }
  });
}

export function approvalRequiredResponse(request: GenerationApprovalRequest) {
  return {
    ok: false,
    error: {
      code: "generation_confirmation_required",
      message: "Confirmation required before credits are charged.",
    },
    data: { status: "confirmation_required", ...request },
  };
}

function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Missing or invalid bearer token." } });
}

function approvalError(error: unknown, reply: FastifyReply) {
  if (error instanceof GenerationApprovalError) {
    return reply.code(error.statusCode).send({ ok: false, error: { code: error.code, message: error.message } });
  }
  console.error("[generation-approvals] request failed", error);
  return reply.code(500).send({ ok: false, error: { code: "generation_approval_failed", message: "Unable to update generation confirmation." } });
}
