import { captureIsolatedWebsite, WebsiteCaptureError } from "../../website-capture/isolated-browser.js";
import { softDeleteWebsiteCaptureAssets } from "../../website-capture/asset-cleanup.js";
import { registerExecutor, type ExecutorContext } from "../job-executor.js";
import { assertConnectorEnabled } from "../../agent-goals/connector-gate.js";
import { completeWebsiteCapture } from "../../website-capture/complete-capture.js";
import { claimApprovedRecording, recordingActionFromTask } from "../../website-capture/recording-approval.js";

async function resolveCaptureTaskId(jobId: string, ctx: ExecutorContext): Promise<string> {
  const job = await ctx.jobService.getJobAdmin(jobId);
  const payload = job.payload as Record<string, unknown> | null;
  const taskId = payload?.task_id;
  if (typeof taskId === "string" && taskId.trim()) return taskId;

  const linkedTasks = await ctx.localDb!.query<{ id: string }>(
    "select id from website_capture_tasks where background_job_id=$1 limit 2",
    [jobId],
  );
  if (linkedTasks.rows.length === 1) return linkedTasks.rows[0]!.id;
  if (linkedTasks.rows.length > 1) {
    throw Object.assign(new Error("Website capture job is linked to multiple tasks."), { code: "invalid_input" });
  }
  throw Object.assign(new Error("Website capture job is missing task_id."), { code: "invalid_input" });
}

registerExecutor("website_capture", async (jobId, _queueMessage, ctx: ExecutorContext) => {
  if (!ctx.localDb) throw new Error("Website capture requires the local database runtime.");

  const taskId = await resolveCaptureTaskId(jobId, ctx);
  const job = await ctx.jobService.getJobAdmin(jobId);
  const approvalId = (job.payload as Record<string, unknown> | null)?.recording_approval_id;

  const task = (await ctx.localDb.query<{
    id: string;
    workspace_id: string;
    created_by: string;
    mode: string;
    session_id: string | null;
    assistant_connection_id: string | null;
    start_url: string;
    page_limit: number;
    record_video: boolean;
    presentation: import("@helstera/shared").WebsitePresentation | null;
    follow_external: boolean;
    status: string;
  }>(
    "select id, workspace_id, created_by, mode, session_id, assistant_connection_id, start_url, page_limit, record_video, presentation, follow_external, status from website_capture_tasks where id=$1",
    [taskId],
  )).rows[0];
  if (!task) throw Object.assign(new Error("Website capture task was not found."), { code: "invalid_input" });
  if (task.status === "canceled") throw Object.assign(new Error("Website capture was canceled."), { code: "job_canceled" });

  const claimed = task.record_video
    ? typeof approvalId === "string" && await claimApprovedRecording(ctx.localDb, taskId, recordingActionFromTask(task), approvalId)
    : (await ctx.localDb.query<{ id: string }>(
      "update website_capture_tasks set status='running', progress=1, stage='connecting', updated_at=now() where id=$1 and record_video=false and status in ('queued','failed') returning id",
      [taskId],
    )).rows.length === 1;
  if (!claimed) {
    throw Object.assign(new Error("Website capture could not be claimed; it may already be running or have ended."), { code: "capture_not_claimed" });
  }
  const onProgress = async (progress: number, stage: string, detail = "") => {
    await assertConnectorEnabled(ctx.localDb!, task.workspace_id, task.created_by, "isolated-browser");
    await ctx.localDb!.query(
      "update website_capture_tasks set progress=$2, stage=$3, updated_at=now() where id=$1 and status='running'",
      [taskId, Math.max(0, Math.min(100, progress)), stage],
    );
    await appendEvent(ctx, taskId, stage, detail);
    await ctx.jobService.updateProgress(jobId, progress, stage);
  };

  try {
    await appendEvent(ctx, taskId, "connecting", "正在启动隔离浏览器");
    await assertConnectorEnabled(ctx.localDb, task.workspace_id, task.created_by, "isolated-browser");
    const result = await captureIsolatedWebsite({
      db: ctx.localDb,
      storage: ctx.storage,
      storageRoot: ctx.env.storageRoot ?? "/www/helstera/uploads",
      webOrigin: ctx.env.webOrigin,
      task,
      onProgress,
    });
    if (!await completeWebsiteCapture(ctx.localDb, taskId, result)) {
      throw Object.assign(new Error("Website capture is no longer running."), { code: "job_canceled" });
    }
    await appendEvent(ctx, taskId, "completed", "网站介绍与素材已保存").catch((eventError) => {
      console.error("[website-capture] failed to append completed event", eventError);
    });
    return result as unknown as Record<string, unknown>;
  } catch (error) {
    const code = error instanceof WebsiteCaptureError ? error.code : ((error as { code?: string }).code ?? "executor_error");
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    await ctx.localDb.query(
      "update website_capture_tasks set status=case when status='canceled' then 'canceled' else 'failed' end, stage=case when status='canceled' then 'canceled' else 'failed' end, error_message=$2, updated_at=now() where id=$1 and status in ('queued','running')",
      [taskId, message],
    );
    await softDeleteWebsiteCaptureAssets(ctx.localDb, taskId).catch((cleanupError) => {
      console.error("[website-capture] failed to soft-delete failed assets", cleanupError);
    });
    await appendEvent(ctx, taskId, code, message);
    throw Object.assign(error instanceof Error ? error : new Error(message), { code });
  }
});

async function appendEvent(ctx: ExecutorContext, taskId: string, stage: string, detail: string) {
  await ctx.localDb?.query(
    "insert into website_capture_events(task_id, stage, detail) values($1,$2,$3)",
    [taskId, stage, detail.slice(0, 1000)],
  );
}
