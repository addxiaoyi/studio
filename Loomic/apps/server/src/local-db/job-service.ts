import type { Pool } from "pg";
import type { BackgroundJob, BackgroundJobStatus, BackgroundJobType } from "@helstera/shared";
import type { AuthenticatedUser } from "../supabase/user.js";
import type { CreateJobInput, JobService } from "../features/jobs/job-service.js";
import { JobServiceError } from "../features/jobs/job-service.js";

const queueNames: Record<BackgroundJobType, string> = { image_generation: "image_generation_jobs", video_generation: "video_generation_jobs" };
const columns = "id, workspace_id, project_id, canvas_id, session_id, thread_id, queue_name, job_type, status, payload, result, error_code, error_message, attempt_count, max_attempts, created_by, created_at, updated_at, started_at, completed_at, failed_at, canceled_at";

export function createLocalJobService(db: Pool): JobService {
  return {
    async createJob(user, input: CreateJobInput) { const { rows } = await db.query(`insert into background_jobs (workspace_id, project_id, canvas_id, session_id, thread_id, queue_name, job_type, payload, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${columns}`, [input.workspaceId, input.projectId ?? null, input.canvasId ?? null, input.sessionId ?? null, input.threadId ?? null, queueNames[input.jobType], input.jobType, input.payload, user.id]); return mapJob(rows[0]); },
    async getJob(user, jobId) { const { rows } = await db.query(`select ${columns} from background_jobs where id = $1 and created_by = $2`, [jobId, user.id]); if (!rows[0]) throw new JobServiceError("job_not_found", "Job not found.", 404); return mapJob(rows[0]); },
    async listJobs(user, filters) { const values: unknown[] = [user.id]; const where = ["created_by = $1"]; if (filters?.status) { values.push(filters.status); where.push(`status = $${values.length}`); } if (filters?.jobType) { values.push(filters.jobType); where.push(`job_type = $${values.length}`); } const { rows } = await db.query(`select ${columns} from background_jobs where ${where.join(" and ")} order by created_at desc limit 50`, values); return rows.map(mapJob); },
    async cancelJob(user, jobId) { const { rows } = await db.query(`update background_jobs set status = 'canceled', canceled_at = now(), updated_at = now() where id = $1 and created_by = $2 and status in ('queued','running') returning ${columns}`, [jobId, user.id]); if (!rows[0]) throw new JobServiceError("job_not_found", "Job not found or already completed.", 404); return mapJob(rows[0]); },
    async getJobAdmin(jobId) { const { rows } = await db.query(`select ${columns} from background_jobs where id = $1`, [jobId]); if (!rows[0]) throw new JobServiceError("job_not_found", "Job not found.", 404); return mapJob(rows[0]); },
    async setCreditsInfo(jobId, creditsCost, transactionId) { await db.query("update background_jobs set credits_cost = $1, credits_transaction_id = $2, updated_at = now() where id = $3", [creditsCost, transactionId, jobId]); },
    async markRunning(jobId) { await db.query("update background_jobs set status = 'running', started_at = now(), updated_at = now() where id = $1 and status = 'queued'", [jobId]); },
    async markSucceeded(jobId, result) { await db.query("update background_jobs set status = 'succeeded', result = $1, completed_at = now(), updated_at = now() where id = $2", [result, jobId]); },
    async markFailed(jobId, errorCode, errorMessage) { await db.query("update background_jobs set status = 'failed', error_code = $1, error_message = $2, failed_at = now(), updated_at = now() where id = $3", [errorCode, errorMessage, jobId]); },
    async markDeadLetter(jobId, errorCode, errorMessage) { await db.query("update background_jobs set status = 'dead_letter', error_code = $1, error_message = $2, failed_at = now(), updated_at = now() where id = $3", [errorCode, errorMessage, jobId]); },
    async incrementAttempt(jobId) { const { rows } = await db.query("update background_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = $1 returning attempt_count, max_attempts", [jobId]); return rows[0] ?? { attempt_count: 1, max_attempts: 3 }; },
  };
}

function mapJob(row: any): BackgroundJob { return { id: row.id, workspace_id: row.workspace_id, project_id: row.project_id, canvas_id: row.canvas_id, session_id: row.session_id, thread_id: row.thread_id, queue_name: row.queue_name, job_type: row.job_type, status: row.status, payload: row.payload ?? {}, result: row.result, error_code: row.error_code, error_message: row.error_message, attempt_count: row.attempt_count, max_attempts: row.max_attempts, created_by: row.created_by, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString(), started_at: row.started_at ? new Date(row.started_at).toISOString() : null, completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null, failed_at: row.failed_at ? new Date(row.failed_at).toISOString() : null, canceled_at: row.canceled_at ? new Date(row.canceled_at).toISOString() : null }; }
