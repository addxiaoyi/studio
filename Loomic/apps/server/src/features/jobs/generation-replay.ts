import { resolveVideoResolution, type VideoResolution } from "@helstera/shared";
import type { Pool } from "pg";
import { JobServiceError } from "./job-service.js";

type MediaJob = "image_generation" | "video_generation";
type ReplayJob = {
  id: string; workspace_id: string; job_type: string; status: string; stage: string | null;
  project_id: string | null; canvas_id: string | null; session_id: string | null; thread_id: string | null;
  payload: Record<string, unknown>;
};

export function assertGenerationReplay(job: ReplayJob, workspaceId: string, type: MediaJob, request: Record<string, unknown>) {
  const saved = job.payload;
  const conflict = () => new JobServiceError("job_create_failed", "此重试标识已关联另一组生成参数，请使用新的生成任务。", 409);
  if (job.workspace_id !== workspaceId || job.job_type !== type || typeof saved.model !== "string") throw conflict();
  for (const key of ["project_id", "canvas_id", "session_id", "thread_id"] as const) {
    if ((job[key] ?? null) !== (request[key] ?? null)) throw conflict();
  }
  const normalize = (payload: Record<string, unknown>) => ({
    prompt: payload.prompt,
    model: payload.model ?? saved.model,
    purpose: payload.purpose ?? null,
    aspect_ratio: payload.aspect_ratio ?? null,
    input_images: payload.input_images ?? [],
    input_asset_ids: payload.input_asset_ids ?? [],
    ...(type === "video_generation" ? {
      duration: payload.duration ?? null,
      resolution: resolveVideoResolution(saved.model as string, payload.resolution as VideoResolution | undefined),
      input_video: payload.input_video ?? null,
      enable_audio: payload.enable_audio ?? false,
    } : {}),
  });
  if (JSON.stringify(normalize(saved)) !== JSON.stringify(normalize(request))) throw conflict();
}

export async function loadGenerationReplay(db: Pool, userId: string, workspaceId: string, type: MediaJob,
  key: string, request: Record<string, unknown>) {
  const job = (await db.query<ReplayJob>(`select id,workspace_id,job_type,status,stage,payload,
    project_id,canvas_id,session_id,thread_id from background_jobs where created_by=$1 and idempotency_key=$2`, [userId, key])).rows[0];
  if (!job) return null;
  assertGenerationReplay(job, workspaceId, type, request);
  return { ...job, pending: job.status === "queued" && job.stage === "awaiting_credit_reservation" };
}
