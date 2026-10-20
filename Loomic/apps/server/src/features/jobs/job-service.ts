import type {
  BackgroundJob,
  BackgroundJobStatus,
  BackgroundJobType,
  Json,
} from "@helstera/shared";

import type { PgmqClient } from "../../queue/pgmq-client.js";
import type {
  AuthenticatedUser,
  DataClient,
} from "../../auth/types.js";
import type { DataAdminClient } from "../../auth/types.js";

// Queue name mapping
const QUEUE_MAP: Record<BackgroundJobType, string> = {
  image_generation: "image_generation_jobs",
  video_generation: "video_generation_jobs",
  website_capture: "website_capture_jobs",
};

export class JobServiceError extends Error {
  readonly statusCode: number;
  readonly code:
    | "job_not_found"
    | "job_create_failed"
    | "job_query_failed"
    | "job_cancel_failed";

  constructor(
    code: JobServiceError["code"],
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.name = "JobServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type CreateJobInput = {
  workspaceId: string;
  projectId?: string;
  canvasId?: string;
  sessionId?: string;
  threadId?: string;
  idempotencyKey?: string;
  jobType: BackgroundJobType;
  payload: Record<string, unknown>;
};

export type JobService = {
  createJob(user: AuthenticatedUser, input: CreateJobInput): Promise<BackgroundJob & { reused: boolean; reactivated?: boolean }>;
  getJob(user: AuthenticatedUser, jobId: string): Promise<BackgroundJob>;
  listJobs(
    user: AuthenticatedUser,
    filters?: { status?: BackgroundJobStatus; jobType?: BackgroundJobType },
  ): Promise<BackgroundJob[]>;
  cancelJob(user: AuthenticatedUser, jobId: string): Promise<BackgroundJob>;
  retryJob(user: AuthenticatedUser, jobId: string): Promise<BackgroundJob>;
  getJobAdmin(jobId: string): Promise<BackgroundJob>;

  // Admin-only methods (use admin client, no user auth)
  setCreditsInfo(jobId: string, creditsCost: number, transactionId: string): Promise<void>;
  markRunning(jobId: string): Promise<void>;
  markSucceeded(jobId: string, result: Record<string, unknown>): Promise<void>;
  markFailed(jobId: string, errorCode: string, errorMessage: string): Promise<void>;
  markDeadLetter(jobId: string, errorCode: string, errorMessage: string): Promise<void>;
  saveProviderResult(jobId: string, result: Record<string, unknown>): Promise<void>;
  hasProviderCheckpoint(jobId: string): Promise<boolean>;
  retryProviderCheckpoint(jobId: string): Promise<boolean>;
  markSyncPending(jobId: string, result: Record<string, unknown>, errorCode: string, errorMessage: string): Promise<void>;
  markSyncFailed(jobId: string, errorCode: string, errorMessage: string): Promise<void>;
  incrementAttempt(jobId: string): Promise<{ attempt_count: number; max_attempts: number }>;
  claimJob(jobId: string): Promise<{ attempt_count: number; max_attempts: number } | null>;
  updateProgress(jobId: string, progress: number, stage: string): Promise<void>;
};

export function createJobService(options: {
  createUserClient: (accessToken: string) => DataClient;
  getAdminClient: () => DataAdminClient;
  pgmq: PgmqClient;
}): JobService {
  function mapJobRow(row: Record<string, unknown>): BackgroundJob {
    return {
      id: row.id as string,
      workspace_id: row.workspace_id as string,
      project_id: (row.project_id as string) ?? null,
      canvas_id: (row.canvas_id as string) ?? null,
      session_id: (row.session_id as string) ?? null,
      thread_id: (row.thread_id as string) ?? null,
      queue_name: row.queue_name as string,
      job_type: row.job_type as BackgroundJob["job_type"],
      status: row.status as BackgroundJob["status"],
      payload: (row.payload as Record<string, unknown>) ?? {},
      result: (row.result as Record<string, unknown>) ?? null,
      error_code: (row.error_code as string) ?? null,
      error_message: (row.error_message as string) ?? null,
      progress: Number(row.progress ?? 0),
      stage: (row.stage as string) ?? null,
      attempt_count: row.attempt_count as number,
      max_attempts: row.max_attempts as number,
      created_by: row.created_by as string,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      started_at: (row.started_at as string) ?? null,
      completed_at: (row.completed_at as string) ?? null,
      failed_at: (row.failed_at as string) ?? null,
      canceled_at: (row.canceled_at as string) ?? null,
      sync_attempt_count: Number(row.sync_attempt_count ?? 0),
      next_sync_at: (row.next_sync_at as string) ?? null,
      sync_error_code: (row.sync_error_code as string) ?? null,
      sync_error_message: (row.sync_error_message as string) ?? null,
    };
  }

  const SELECT_COLS =
    "id, workspace_id, project_id, canvas_id, session_id, thread_id, idempotency_key, queue_name, job_type, status, payload, result, error_code, error_message, progress, stage, attempt_count, max_attempts, created_by, created_at, updated_at, started_at, completed_at, failed_at, canceled_at, sync_attempt_count, next_sync_at, sync_error_code, sync_error_message";

  async function findIdempotentJob(
    client: DataClient,
    userId: string,
    idempotencyKey: string,
  ) {
    const { data, error } = await client
      .from("background_jobs")
      .select(SELECT_COLS)
      .eq("created_by", userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) {
      throw new JobServiceError("job_query_failed", "Failed to query idempotent job.", 500);
    }
    return data ? mapJobRow(data as unknown as Record<string, unknown>) : null;
  }

  async function reactivateCanceledJob(
    client: DataClient,
    user: AuthenticatedUser,
    input: CreateJobInput,
    existing: BackgroundJob,
  ) {
    const { data, error } = await client
      .from("background_jobs")
      .update({ status: "queued", canceled_at: null, failed_at: null, error_code: null, error_message: null, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("created_by", user.id)
      .eq("status", "canceled")
      .select(SELECT_COLS)
      .maybeSingle();
    if (error) throw new JobServiceError("job_create_failed", "Failed to requeue canceled job.", 500);
    if (!data) return null;
    try {
      await options.pgmq.send(QUEUE_MAP[input.jobType], {
        job_id: existing.id,
        job_type: input.jobType,
        workspace_id: input.workspaceId,
        ...(input.canvasId ? { canvas_id: input.canvasId } : {}),
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
      });
    } catch (enqueueError) {
      await client.from("background_jobs").update({ status: "canceled", canceled_at: new Date().toISOString() }).eq("id", existing.id);
      throw new JobServiceError("job_create_failed", "Failed to requeue canceled job.", 500);
    }
    return { ...mapJobRow(data as unknown as Record<string, unknown>), reused: true, reactivated: true };
  }

  return {
    async createJob(user, input) {
      const client = options.createUserClient(user.accessToken);
      const queueName = QUEUE_MAP[input.jobType];

      if (input.idempotencyKey) {
        const existing = await findIdempotentJob(client, user.id, input.idempotencyKey);
        if (existing?.status === "canceled") {
          const reactivated = await reactivateCanceledJob(client, user, input, existing);
          if (reactivated) return reactivated;
        }
        if (existing) return { ...existing, reused: true };
      }

      const { data: job, error } = await client
        .from("background_jobs")
        .insert({
          workspace_id: input.workspaceId,
          project_id: input.projectId ?? null,
          canvas_id: input.canvasId ?? null,
          session_id: input.sessionId ?? null,
          thread_id: input.threadId ?? null,
          idempotency_key: input.idempotencyKey ?? null,
          queue_name: queueName,
          job_type: input.jobType,
          payload: input.payload as Json,
          created_by: user.id,
        })
        .select(SELECT_COLS)
        .single();

      if (error || !job) {
        if (input.idempotencyKey && isUniqueViolation(error)) {
          const existing = await findIdempotentJob(client, user.id, input.idempotencyKey);
          if (existing?.status === "canceled") {
            const reactivated = await reactivateCanceledJob(client, user, input, existing);
            if (reactivated) return reactivated;
          }
          if (existing) return { ...existing, reused: true };
        }
        throw new JobServiceError(
          "job_create_failed",
          "Failed to create job record.",
          500,
        );
      }

      // Enqueue to pgmq — rollback on failure
      try {
        await options.pgmq.send(queueName, {
          job_id: job.id,
          job_type: input.jobType,
          workspace_id: input.workspaceId,
          ...(input.canvasId ? { canvas_id: input.canvasId } : {}),
          ...(input.sessionId ? { session_id: input.sessionId } : {}),
        });
      } catch (enqueueErr) {
        console.error("[job-service] pgmq.send failed:", enqueueErr);
        await client.from("background_jobs").delete().eq("id", job.id);
        throw new JobServiceError(
          "job_create_failed",
          "Failed to enqueue job.",
          500,
        );
      }

      return { ...mapJobRow(job as unknown as Record<string, unknown>), reused: false };
    },
    async retryJob(user, jobId) {
      const client = options.createUserClient(user.accessToken);
      const { data, error } = await client
        .from("background_jobs")
        .update({ status: "queued", canceled_at: null, failed_at: null, error_code: null, error_message: null, updated_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("created_by", user.id)
        .in("status", ["failed", "dead_letter"])
        .select(SELECT_COLS)
        .maybeSingle();
      if (error || !data) throw new JobServiceError("job_not_found", "Job not found or not retryable.", 409);
      const job = mapJobRow(data as unknown as Record<string, unknown>);
      try {
        await options.pgmq.send(job.queue_name, { job_id: job.id, job_type: job.job_type, workspace_id: job.workspace_id });
      } catch {
        await client.from("background_jobs").update({ status: "failed", failed_at: new Date().toISOString() }).eq("id", jobId).eq("created_by", user.id);
        throw new JobServiceError("job_create_failed", "Failed to requeue job.", 500);
      }
      return job;
    },

    async getJob(user, jobId) {
      const client = options.createUserClient(user.accessToken);
      const { data: job, error } = await client
        .from("background_jobs")
        .select(SELECT_COLS)
        .eq("id", jobId)
        .maybeSingle();

      if (error) {
        throw new JobServiceError("job_query_failed", "Failed to query job.", 500);
      }
      if (!job) {
        throw new JobServiceError("job_not_found", "Job not found.", 404);
      }
      return mapJobRow(job as unknown as Record<string, unknown>);
    },

    async listJobs(user, filters) {
      const client = options.createUserClient(user.accessToken);
      let query = client
        .from("background_jobs")
        .select(SELECT_COLS)
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.jobType) query = query.eq("job_type", filters.jobType);

      const { data: jobs, error } = await query;
      if (error) {
        throw new JobServiceError("job_query_failed", "Failed to list jobs.", 500);
      }
      return (jobs ?? []).map((row) =>
        mapJobRow(row as unknown as Record<string, unknown>),
      );
    },

    async cancelJob(user, jobId) {
      const client = options.createUserClient(user.accessToken);
      const { data: job, error } = await client
        .from("background_jobs")
        .update({ status: "canceled", canceled_at: new Date().toISOString() })
        .eq("id", jobId)
        .in("status", ["queued", "running"])
        .select(SELECT_COLS)
        .maybeSingle();

      if (error) {
        throw new JobServiceError("job_cancel_failed", "Failed to cancel job.", 500);
      }
      if (!job) {
        throw new JobServiceError(
          "job_not_found",
          "Job not found or already completed.",
          404,
        );
      }
      return mapJobRow(job as unknown as Record<string, unknown>);
    },

    async getJobAdmin(jobId) {
      const admin = options.getAdminClient();
      const { data: job, error } = await admin
        .from("background_jobs")
        .select(SELECT_COLS)
        .eq("id", jobId)
        .maybeSingle();

      if (error) {
        throw new JobServiceError("job_query_failed", "Failed to query job.", 500);
      }
      if (!job) {
        throw new JobServiceError("job_not_found", "Job not found.", 404);
      }
      return mapJobRow(job as unknown as Record<string, unknown>);
    },

    // --- Admin-only methods (admin client, bypasses RLS) ---

    async setCreditsInfo(jobId, creditsCost, transactionId) {
      const admin = options.getAdminClient();
      await admin
        .from("background_jobs")
        .update({
          credits_cost: creditsCost,
          credits_transaction_id: transactionId,
        })
        .eq("id", jobId)
        .eq("status", "running");
    },

    async markRunning(jobId) {
      const admin = options.getAdminClient();
      await admin
        .from("background_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("status", "queued");
    },

    async claimJob(jobId) {
      const admin = options.getAdminClient();
      const { data, error } = await admin
        .from("background_jobs")
        .update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", jobId)
        .in("status", ["queued", "failed"])
        .select("attempt_count,max_attempts")
        .maybeSingle();
      if (error) throw new Error(`Failed to claim job: ${error.message}`);
      return data
        ? { attempt_count: Number(data.attempt_count ?? 1), max_attempts: Number(data.max_attempts ?? 3) }
        : null;
    },
    async markSucceeded(jobId, result) {
      const admin = options.getAdminClient();
      await admin
        .from("background_jobs")
        .update({
          status: "succeeded",
          result: result as Json,
          error_code: null,
          error_message: null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("status", "running");
    },

    async markFailed(jobId, errorCode, errorMessage) {
      const admin = options.getAdminClient();
      await admin
        .from("background_jobs")
        .update({
          status: "failed",
          error_code: errorCode,
          error_message: errorMessage,
          failed_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("status", "running");
    },

    async markDeadLetter(jobId, errorCode, errorMessage) {
      const admin = options.getAdminClient();
      await admin
        .from("background_jobs")
        .update({
          status: "dead_letter",
          error_code: errorCode,
          error_message: errorMessage,
          failed_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("status", "running");
    },

    async saveProviderResult(jobId, result) {
      const admin = options.getAdminClient();
      const { data, error } = await admin.from("background_jobs").update({ provider_result: result as Json }).eq("id", jobId).eq("status", "running").select("id").maybeSingle();
      if (error || !data) {
        const failure = new Error(`Failed to checkpoint Provider result for job ${jobId}: ${error?.message ?? "job is no longer running"}`);
        (failure as Error & { code?: string }).code = "upstream_outcome_unknown";
        throw failure;
      }
    },

    async hasProviderCheckpoint(jobId) {
      const admin = options.getAdminClient();
      const { data, error } = await admin.from("background_jobs").select("provider_result").eq("id", jobId).maybeSingle();
      if (error) throw new Error(`Failed to inspect Provider checkpoint for job ${jobId}: ${error.message}`);
      return Boolean(data?.provider_result && typeof data.provider_result === "object");
    },

    async retryProviderCheckpoint(jobId) {
      const admin = options.getAdminClient();
      const { data, error } = await admin.from("background_jobs").update({ status: "queued", attempt_count: 0, failed_at: null, error_code: null, error_message: null, sync_claimed_at: null, updated_at: new Date().toISOString() }).eq("id", jobId).eq("status", "sync_failed").not("provider_result", "is", null).is("result->>asset_id", null).select("id, job_type, workspace_id").maybeSingle();
      if (error) throw new Error(`Failed to retry Provider checkpoint for job ${jobId}: ${error.message}`);
      if (!data) return false;
      try {
        await options.pgmq.send(QUEUE_MAP[data.job_type as BackgroundJobType], { job_id: jobId, job_type: data.job_type, workspace_id: data.workspace_id });
      } catch (enqueueError) {
        await admin.from("background_jobs").update({ status: "sync_failed", updated_at: new Date().toISOString() }).eq("id", jobId).eq("status", "queued");
        throw enqueueError;
      }
      return true;
    },

    async markSyncPending(jobId, result, errorCode, errorMessage) {
      const admin = options.getAdminClient();
      await admin.from("background_jobs").update({ status: "sync_pending", result: result as Json, stage: "canvas_sync_pending", sync_error_code: errorCode, sync_error_message: errorMessage, error_code: errorCode, error_message: errorMessage, next_sync_at: new Date().toISOString() }).eq("id", jobId).eq("status", "running");
    },
    async markSyncFailed(jobId, errorCode, errorMessage) {
      const admin = options.getAdminClient();
      await admin.from("background_jobs").update({ status: "sync_failed", sync_error_code: errorCode, sync_error_message: errorMessage, error_code: errorCode, error_message: errorMessage, stage: "provider_result_sync_failed", next_sync_at: null, sync_claimed_at: null, failed_at: new Date().toISOString() }).eq("id", jobId).in("status", ["running", "sync_pending", "sync_failed"]);
    },    async incrementAttempt(jobId) {
      const admin = options.getAdminClient();
      // NOTE: increment_job_attempt may not be in generated Supabase types yet
      const { data, error } = await (admin as any).rpc("increment_job_attempt", {
        p_job_id: jobId,
      });

      if (error) {
        console.error("[job-service] increment_job_attempt RPC failed:", error.message);
        return { attempt_count: 1, max_attempts: 3 };
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (row && typeof row === "object") {
        return {
          attempt_count: (row as any).attempt_count as number,
          max_attempts: ((row as any).max_attempts as number) ?? 3,
        };
      }
      // Job not found — return safe defaults
      return { attempt_count: 1, max_attempts: 3 };
    },
    async updateProgress(jobId, progress, stage) {
      await (options.getAdminClient() as any).from("background_jobs").update({ progress: Math.max(0, Math.min(100, progress)), stage }).eq("id", jobId);
    },
  };
}

function isUniqueViolation(error: { code?: string } | null) {
  return error?.code === "23505";
}
