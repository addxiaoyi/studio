import type { Pool } from "pg";
import type { BackgroundJob, BackgroundJobStatus, BackgroundJobType } from "@helstera/shared";
import type { AuthenticatedUser } from "../auth/types.js";
import type { CreateJobInput, JobService } from "../features/jobs/job-service.js";
import { JobServiceError } from "../features/jobs/job-service.js";
import type { PgmqClient } from "../queue/pgmq-client.js";

const queueNames: Record<BackgroundJobType, string> = { image_generation: "image_generation_jobs", video_generation: "video_generation_jobs", website_capture: "website_capture_jobs" };
const columns = "id, workspace_id, project_id, canvas_id, session_id, thread_id, idempotency_key, queue_name, job_type, status, payload, result, error_code, error_message, progress, stage, attempt_count, max_attempts, created_by, created_at, updated_at, started_at, completed_at, failed_at, canceled_at, sync_attempt_count, next_sync_at, sync_error_code, sync_error_message";
/**
 * List reads must never pull the raw `payload`: image jobs embed multi-megabyte data
 * URIs there, and parsing that much JSON into Node cost ~4s per /api/jobs call even
 * though PostgreSQL answered in under 1ms. `payload_summary` is written alongside the
 * payload and holds the elided, stable-shape copy the list UI actually reads.
 */
const listColumns = "id, workspace_id, project_id, canvas_id, session_id, thread_id, idempotency_key, queue_name, job_type, status, coalesce(payload_summary, '{}'::jsonb) as payload, result, error_code, error_message, progress, stage, attempt_count, max_attempts, created_by, created_at, updated_at, started_at, completed_at, failed_at, canceled_at, sync_attempt_count, next_sync_at, sync_error_code, sync_error_message";

export function createLocalJobService(db: Pool, queue?: PgmqClient): JobService {
  return {
    async createJob(user, input: CreateJobInput) {
      const insert = await db.query(`insert into background_jobs (workspace_id, project_id, canvas_id, session_id, thread_id, idempotency_key, queue_name, job_type, payload, payload_summary, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (created_by, idempotency_key) where idempotency_key is not null do nothing returning ${columns}`, [input.workspaceId, input.projectId ?? null, input.canvasId ?? null, input.sessionId ?? null, input.threadId ?? null, input.idempotencyKey ?? null, queueNames[input.jobType], input.jobType, input.payload, JSON.stringify(trimListPayload(input.payload) ?? null), user.id]);
      if (insert.rows[0]) {
        const job = mapJob(insert.rows[0]);
        try {
          if (queue) await queue.send(queueNames[input.jobType], { job_id: job.id, job_type: input.jobType, workspace_id: input.workspaceId });
          else await db.query("update background_jobs set status = 'queued', updated_at = now() where id = $1", [job.id]);
        } catch (error) {
          await db.query("delete from background_jobs where id = $1 and status = 'queued'", [job.id]);
          throw new JobServiceError("job_create_failed", `Failed to enqueue job: ${error instanceof Error ? error.message : String(error)}`, 500);
        }
        return { ...job, status: "queued", reused: false };
      }
      if (input.idempotencyKey) {
        const existing = await db.query(`select ${columns} from background_jobs where created_by=$1 and idempotency_key=$2`, [user.id, input.idempotencyKey]);
        if (existing.rows[0] && existing.rows[0].status !== "canceled") return { ...mapJob(existing.rows[0]), reused: true };
        const reactivated = await db.query(`update background_jobs set status = 'queued', canceled_at = null, failed_at = null, error_code = null, error_message = null, updated_at = now() where id = $1 and status = 'canceled' returning ${columns}`, [existing.rows[0].id]);
        if (reactivated.rows[0]) {
          try {
            if (queue) await queue.send(queueNames[input.jobType], { job_id: reactivated.rows[0].id, job_type: input.jobType, workspace_id: input.workspaceId });
            return { ...mapJob(reactivated.rows[0]), status: "queued", reused: true, reactivated: true };
          } catch (error) {
            await db.query("update background_jobs set status = 'canceled', canceled_at = now(), updated_at = now() where id = $1", [reactivated.rows[0].id]);
            throw new JobServiceError("job_create_failed", `Failed to re-enqueue job: ${error instanceof Error ? error.message : String(error)}`, 500);
          }
        }
        const current = await db.query(`select ${columns} from background_jobs where created_by=$1 and idempotency_key=$2`, [user.id, input.idempotencyKey]);
        if (current.rows[0]) return { ...mapJob(current.rows[0]), reused: true };
      }
      throw new JobServiceError("job_create_failed", "Failed to create job record.", 500);
    },
    async getJob(user, jobId) { const { rows } = await db.query(`select ${columns} from background_jobs where id = $1 and created_by = $2`, [jobId, user.id]); if (!rows[0]) throw new JobServiceError("job_not_found", "Job not found.", 404); return mapJob(rows[0]); },
    async listJobs(user, filters) { const values: unknown[] = [user.id]; const where = ["created_by = $1"]; if (filters?.status) { values.push(filters.status); where.push(`status = $${values.length}`); } if (filters?.jobType) { values.push(filters.jobType); where.push(`job_type = $${values.length}`); } const { rows } = await db.query(`select ${listColumns} from background_jobs where ${where.join(" and ")} order by created_at desc limit 50`, values); return rows.map(mapJobForList); },
    async cancelJob(user, jobId) { const { rows } = await db.query(`update background_jobs set status = 'canceled', canceled_at = now(), updated_at = now() where id = $1 and created_by = $2 and status in ('queued','running') returning ${columns}`, [jobId, user.id]); if (!rows[0]) throw new JobServiceError("job_not_found", "Job not found or already completed.", 404); return mapJob(rows[0]); },
    async retryJob(user, jobId) { const { rows } = await db.query(`update background_jobs set status='queued', canceled_at=null, failed_at=null, error_code=null, error_message=null, updated_at=now() where id=$1 and created_by=$2 and status in ('failed','dead_letter') returning ${columns}`, [jobId, user.id]); if (!rows[0]) throw new JobServiceError("job_not_found", "Job not found or not retryable.", 409); const job = mapJob(rows[0]); if (queue) await queue.send(job.queue_name, { job_id: job.id, job_type: job.job_type, workspace_id: job.workspace_id }); return job; },
    async getJobAdmin(jobId) { const { rows } = await db.query(`select ${columns} from background_jobs where id = $1`, [jobId]); if (!rows[0]) throw new JobServiceError("job_not_found", "Job not found.", 404); return mapJob(rows[0]); },
    async setCreditsInfo(jobId, creditsCost, transactionId) { await db.query("update background_jobs set credits_cost = $1, credits_transaction_id = $2, updated_at = now() where id = $3", [creditsCost, transactionId, jobId]); },
    async markRunning(jobId) { await db.query("update background_jobs set status = 'running', started_at = now(), updated_at = now() where id = $1 and status = 'queued'", [jobId]); },
    async claimJob(jobId) {
      const { rows } = await db.query<{ attempt_count: number; max_attempts: number }>(
        "update background_jobs set status = 'running', attempt_count = attempt_count + 1, started_at = now(), updated_at = now() where id = $1 and status in ('queued','failed') returning attempt_count, max_attempts",
        [jobId],
      );
      return rows[0] ? { attempt_count: Number(rows[0].attempt_count), max_attempts: Number(rows[0].max_attempts ?? 3) } : null;
    },
    async markSucceeded(jobId, result) {
      const updated = await db.query<{ workspace_id: string; created_by: string | null; job_type: BackgroundJobType }>(
        "update background_jobs set status = 'succeeded', result = $1, error_code = null, error_message = null, completed_at = now(), updated_at = now() where id = $2 and status = 'running' returning workspace_id,created_by,job_type",
        [result, jobId],
      );
      await notifyGeneration(db, updated.rows[0], jobId, "asset_ready", "Asset ready", "Your generated asset is ready.", result);
    },
    async markFailed(jobId, errorCode, errorMessage) {
      const updated = await db.query<{ workspace_id: string; created_by: string | null; job_type: BackgroundJobType; attempt_count: number; max_attempts: number }>(
        "update background_jobs set status = 'failed', error_code = $1, error_message = $2, failed_at = now(), updated_at = now() where id = $3 and status = 'running' returning workspace_id,created_by,job_type,attempt_count,max_attempts",
        [errorCode, errorMessage, jobId],
      );
      const row = updated.rows[0];
      if (row && Number(row.attempt_count) >= Number(row.max_attempts)) {
        await notifyGeneration(db, row, jobId, "asset_failed", "Generation failed", errorMessage, { errorCode });
      }
    },
    async markDeadLetter(jobId, errorCode, errorMessage) {
      const updated = await db.query<{ workspace_id: string; created_by: string | null; job_type: BackgroundJobType }>(
        "update background_jobs set status = 'dead_letter', error_code = $1, error_message = $2, failed_at = now(), updated_at = now() where id = $3 and status = 'running' returning workspace_id,created_by,job_type",
        [errorCode, errorMessage, jobId],
      );
      await notifyGeneration(db, updated.rows[0], jobId, "asset_failed", "Generation failed", errorMessage, { errorCode });
    },
    async saveProviderResult(jobId, result) { const { rowCount } = await db.query("update background_jobs set provider_result = $1::jsonb, updated_at = now() where id = $2 and status = 'running'", [JSON.stringify(result), jobId]); if (!rowCount) { const error = new Error(`Failed to checkpoint Provider result for job ${jobId}: job is no longer running`); Object.assign(error, { code: "upstream_outcome_unknown" }); throw error; } },
    async hasProviderCheckpoint(jobId) { const { rows } = await db.query<{ provider_result: unknown }>("select provider_result from background_jobs where id=$1", [jobId]); return Boolean(rows[0]?.provider_result && typeof rows[0].provider_result === "object"); },
    async retryProviderCheckpoint(jobId) {
      const { rows } = await db.query<{ id: string; job_type: BackgroundJobType; workspace_id: string; queue_name: string }>("update background_jobs set status='queued',attempt_count=0,failed_at=null,error_code=null,error_message=null,sync_claimed_at=null,updated_at=now() where id=$1 and status='sync_failed' and provider_result is not null and result->>'asset_id' is null returning id,job_type,workspace_id,queue_name", [jobId]);
      const job = rows[0];
      if (!job) return false;
      try { if (queue) await queue.send(job.queue_name, { job_id: job.id, job_type: job.job_type, workspace_id: job.workspace_id }); }
      catch (error) { await db.query("update background_jobs set status='sync_failed',updated_at=now() where id=$1 and status='queued'", [jobId]); throw error; }
      return true;
    },
    async markSyncPending(jobId, result, errorCode, errorMessage) { await db.query("update background_jobs set status='sync_pending', result=$1, stage='canvas_sync_pending', sync_error_code=$2, sync_error_message=$3, error_code=$2, error_message=$3, next_sync_at=now(), updated_at=now() where id=$4 and status='running'", [result, errorCode, errorMessage, jobId]); },
    async markSyncFailed(jobId, errorCode, errorMessage) { await db.query("update background_jobs set status='sync_failed', sync_error_code=$1, sync_error_message=$2, error_code=$1, error_message=$2, stage='provider_result_sync_failed', next_sync_at=null, sync_claimed_at=null, failed_at=now(), updated_at=now() where id=$3 and status in ('running','sync_pending','sync_failed')", [errorCode, errorMessage, jobId]); },    async incrementAttempt(jobId) { const { rows } = await db.query("update background_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = $1 returning attempt_count, max_attempts", [jobId]); return rows[0] ?? { attempt_count: 1, max_attempts: 3 }; },
    async updateProgress(jobId, progress, stage) { await db.query("update background_jobs set progress = $1, stage = $2, updated_at = now() where id = $3", [Math.max(0, Math.min(100, progress)), stage, jobId]); },
  };
}

/**
 * Image jobs keep their reference images inline in `payload.input_images` as
 * multi-megabyte data URIs. `/api/jobs` is polled by the workspace home page and by
 * the generation fallback poller, so returning those blobs made one list response
 * reach tens of megabytes. The list view only needs to know that references exist,
 * so elide the blobs while keeping the array shape and every scalar field.
 * Detail reads (`getJob`) still return the untouched payload.
 */
const INLINE_IMAGE_ELIDE_BYTES = 2048;

function trimListPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  const images = record.input_images;
  if (!Array.isArray(images)) return payload;
  let elided = false;
  const next = images.map((value) => {
    if (typeof value === "string" && value.length > INLINE_IMAGE_ELIDE_BYTES) {
      elided = true;
      return `[inline image elided: ${value.length} chars]`;
    }
    return value;
  });
  return elided ? { ...record, input_images: next } : payload;
}

function mapJobForList(row: any): BackgroundJob {
  const job = mapJob(row);
  return { ...job, payload: trimListPayload(job.payload) as BackgroundJob["payload"] };
}

function mapJob(row: any): BackgroundJob { return { id: row.id, workspace_id: row.workspace_id, project_id: row.project_id, canvas_id: row.canvas_id, session_id: row.session_id, thread_id: row.thread_id, queue_name: row.queue_name, job_type: row.job_type, status: row.status, payload: row.payload ?? {}, result: row.result, error_code: row.error_code, error_message: row.error_message, progress: Number(row.progress ?? 0), stage: row.stage ?? null, attempt_count: row.attempt_count, max_attempts: row.max_attempts, created_by: row.created_by, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString(), started_at: row.started_at ? new Date(row.started_at).toISOString() : null, completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null, failed_at: row.failed_at ? new Date(row.failed_at).toISOString() : null, canceled_at: row.canceled_at ? new Date(row.canceled_at).toISOString() : null, sync_attempt_count: Number(row.sync_attempt_count ?? 0), next_sync_at: row.next_sync_at ? new Date(row.next_sync_at).toISOString() : null, sync_error_code: row.sync_error_code ?? null, sync_error_message: row.sync_error_message ?? null }; }

async function notifyGeneration(
  db: Pool,
  row: { workspace_id: string; created_by: string | null; job_type: BackgroundJobType } | undefined,
  jobId: string,
  type: "asset_ready" | "asset_failed",
  title: string,
  body: string,
  metadata: Record<string, unknown>,
) {
  if (!row || !row.created_by || !["image_generation", "video_generation"].includes(row.job_type)) return;
  await db.query(
    "insert into notifications(workspace_id,user_id,type,title,body,metadata) values($1,$2,$3,$4,$5,$6::jsonb)",
    [row.workspace_id, row.created_by, type, title, body, JSON.stringify({ jobId, ...metadata })],
  );
}
