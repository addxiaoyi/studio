import type { Pool } from "pg";

import { insertLocalImageElement, insertLocalVideoElement } from "../canvas/canvas-element-writer.js";
import type { StorageProvider } from "../../storage/index.js";

const SYNC_DELAYS_MS = [30_000, 120_000, 600_000] as const;

type SyncJobRow = {
  id: string;
  job_type: "image_generation" | "video_generation";
  canvas_id: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  sync_attempt_count: number;
};

export type SyncResult =
  | { state: "succeeded"; canvasElementId?: string }
  | { state: "in_progress" }
  | { state: "pending"; attempt: number; nextSyncAt: string; error: string }
  | { state: "failed"; attempt: number; error: string };

export async function syncGenerationJob(
  db: Pool,
  storage: StorageProvider,
  jobId: string,
  options: { force?: boolean } = {},
): Promise<SyncResult> {
  const dueFilter = options.force ? "" : "and (next_sync_at is null or next_sync_at <= now())";
  const { rows } = await db.query<SyncJobRow>(
    `update background_jobs
     set sync_claimed_at = now(), sync_attempt_count = case when $2 then 0 else sync_attempt_count end
     where id = $1 and status in ('sync_pending', 'sync_failed')
       ${dueFilter}
       and (sync_claimed_at is null or sync_claimed_at < now() - interval '15 minutes')
     returning id, job_type, canvas_id, payload, result, sync_attempt_count`,
    [jobId, options.force === true],
  );
  const job = rows[0];
  if (!job) return { state: "in_progress" };

  const result = job.result ?? {};
  const existingCanvasElementId = stringValue(result.canvas_element_id);
  if (existingCanvasElementId) {
    await markSynced(db, jobId, result);
    return { state: "succeeded", canvasElementId: existingCanvasElementId };
  }

  if (!job.canvas_id) {
    await markSynced(db, jobId, result);
    return { state: "succeeded" };
  }

  try {
    const canvasElementId = await insertCanvasElement(db, storage, job);
    const nextResult = { ...result, canvas_element_id: canvasElementId };
    await markSynced(db, jobId, nextResult);
    return { state: "succeeded", canvasElementId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempt = Number(job.sync_attempt_count ?? 0) + 1;
    if (attempt > SYNC_DELAYS_MS.length) {
      await db.query(
        `update background_jobs
         set status = 'sync_failed', sync_attempt_count = $2,
             sync_error_code = 'canvas_sync_failed', sync_error_message = $3,
             error_code = 'canvas_sync_failed', error_message = $3,
             failed_at = now(), sync_claimed_at = null, updated_at = now()
         where id = $1 and status in ('sync_pending', 'sync_failed')`,
        [jobId, attempt, message],
      );
      return { state: "failed", attempt, error: message };
    }

    const delay = SYNC_DELAYS_MS[Math.min(attempt - 1, SYNC_DELAYS_MS.length - 1)]!;
    const nextSyncAt = new Date(Date.now() + delay).toISOString();
    await db.query(
      `update background_jobs
       set status = 'sync_pending', sync_attempt_count = $2,
           next_sync_at = $4, sync_error_code = 'canvas_sync_failed',
           sync_error_message = $3, error_code = 'canvas_sync_failed',
           error_message = $3, stage = 'canvas_sync_pending', sync_claimed_at = null, updated_at = now()
       where id = $1 and status in ('sync_pending', 'sync_failed')`,
      [jobId, attempt, message, nextSyncAt],
    );
    return { state: "pending", attempt, nextSyncAt, error: message };
  }
}

export async function processDueSyncJobs(db: Pool, storage: StorageProvider) {
  const { rows } = await db.query<{ id: string }>(
    `select id from background_jobs
     where status = 'sync_pending'
       and (next_sync_at is null or next_sync_at <= now())
     order by next_sync_at nulls first, updated_at
     limit 20`,
  );
  for (const row of rows) await syncGenerationJob(db, storage, row.id);
  return rows.length;
}

async function insertCanvasElement(
  db: Pool,
  storage: StorageProvider,
  job: SyncJobRow,
) {
  const result = job.result ?? {};
  const assetId = requiredString(result.asset_id, "asset_id");
  const width = numberValue(result.width, 1024)!;
  const height = numberValue(result.height, 1024)!;
  const mimeType = stringValue(result.mime_type) ?? (job.job_type === "video_generation" ? "video/mp4" : "image/png");
  const title = stringValue(result.title) ?? (job.job_type === "video_generation" ? "AI 视频" : "AI 图片");
  const prompt = stringValue(job.payload.prompt) ?? "";

  if (job.job_type === "video_generation") {
    const duration = numberValue(result.duration_seconds, undefined);
    return (await insertLocalVideoElement(db, {
      canvasId: requiredString(job.canvas_id, "canvas_id"),
      signedUrl: requiredString(result.signed_url, "signed_url"),
      assetId,
      width,
      height,
      mimeType,
      ...(duration !== undefined ? { durationSeconds: duration } : {}),
      title,
      prompt,
      jobId: job.id,
    })).elementId;
  }

  return (await insertLocalImageElement(db, storage, {
    canvasId: requiredString(job.canvas_id, "canvas_id"),
    objectPath: requiredString(result.object_path, "object_path"),
    assetId,
    width,
    height,
    mimeType,
    title,
    jobId: job.id,
  })).elementId;
}

async function markSynced(db: Pool, jobId: string, result: Record<string, unknown>) {
  await db.query(
    `update background_jobs
     set status = 'succeeded', result = $2, error_code = null,
         error_message = null, sync_error_code = null,
         sync_error_message = null, next_sync_at = null, sync_claimed_at = null,
         completed_at = now(), updated_at = now()
     where id = $1 and status in ('sync_pending', 'sync_failed')`,
    [jobId, result],
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(value: unknown, name: string) {
  const string = stringValue(value);
  if (!string) throw new Error(`Sync result is missing ${name}`);
  return string;
}

function numberValue(value: unknown, fallback: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
