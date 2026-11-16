import type { Pool } from "pg";
import type { AuthenticatedUser } from "../../auth/types.js";
import type { CreditService } from "../credits/credit-service.js";
import type { JobService } from "../jobs/job-service.js";
import { assertGenerationReplay } from "../jobs/generation-replay.js";
import { createGenerationApprovalService, fingerprintPayload, GenerationApprovalError, type GenerationApprovalRequest } from "./generation-approval-service.js";

export async function startConfirmedGeneration(options: {
  db: Pool;
  jobs: JobService;
  credits?: CreditService;
  user: AuthenticatedUser;
  workspaceId: string;
  approval: GenerationApprovalRequest;
}) {
  const { db, jobs, credits, user, workspaceId, approval } = options;
  const approvalService = createGenerationApprovalService(db);
  const context = approval.context ?? {};
  const existingId = approval.jobId ?? context.reservationJobId;
  const job = existingId
    ? await jobs.getJob(user, existingId)
    : await jobs.createJob(user, {
        workspaceId,
        ...(context.canvasId ? { canvasId: context.canvasId } : {}),
        ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        ...(context.threadId ? { threadId: context.threadId } : {}),
        ...(context.projectId ? { projectId: context.projectId } : {}),
        jobType: approval.jobType,
        idempotencyKey: context.requestKey ?? `approval:${approval.approvalId}`,
        payload: approval.parameters,
        requiresCreditReservation: true,
      });
  assertGenerationReplay(job, workspaceId, approval.jobType, {
    ...approval.parameters,
    project_id: context.projectId,
    canvas_id: context.canvasId,
    session_id: context.sessionId,
    thread_id: context.threadId,
  });
  if (fingerprintPayload(job.payload) !== fingerprintPayload(approval.parameters)) {
    throw new GenerationApprovalError("generation_approval_invalid", "原任务参数与费用确认不一致，请重新核对。");
  }
  if (job.status === "canceled" || (approval.jobId && job.stage !== "awaiting_credit_reservation")) return job;
  if (job.status !== "queued") {
    throw new GenerationApprovalError("generation_approval_invalid", "原任务已经开始或结束，请打开原任务查看。");
  }
  if (approval.estimatedCredits > 0 && !credits) {
    throw new GenerationApprovalError("generation_approval_invalid", "费用服务暂不可用，任务保留待预扣状态。", 503);
  }
  const attached = await approvalService.attachJob(approval.approvalId, job.id);
  if (attached !== job.id) {
    throw new GenerationApprovalError("generation_approval_invalid", "确认与原任务不匹配，请重新核对任务参数。");
  }
  if (approval.estimatedCredits > 0 && credits) {
    try {
      const transaction = await credits.deductCredits(workspaceId, user.id, approval.estimatedCredits, job.id,
        `${approval.jobType === "video_generation" ? "Video" : "Image"} generation`, approval.approvalId);
      await jobs.setCreditsInfo(job.id, approval.estimatedCredits, transaction);
    } catch (cause) {
      await db.query(`update background_jobs set error_code='credit_reservation_failed',
        error_message='积分预扣未完成，请恢复原任务重试或取消。',updated_at=now()
        where id=$1 and status='queued' and stage='awaiting_credit_reservation'`, [job.id]);
      throw cause;
    }
  } else {
    await db.query(`update background_jobs set stage='queued',updated_at=now()
      where id=$1 and status='queued' and stage='awaiting_credit_reservation'`, [job.id]);
  }
  return jobs.getJob(user, job.id);
}
