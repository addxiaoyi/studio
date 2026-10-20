import { captureIsolatedWebsite, WebsiteCaptureError } from "../../website-capture/isolated-browser.js";
import { registerExecutor, type ExecutorContext } from "../job-executor.js";

type CapturePayload = {
  task_id?: string;
};

registerExecutor("website_capture", async (jobId, rawPayload, ctx: ExecutorContext) => {
  if (!ctx.localDb) throw new Error("Website capture requires the local database runtime.");

  const payload = rawPayload as CapturePayload;
  const taskId = payload.task_id;
  if (!taskId) throw Object.assign(new Error("Website capture job is missing task_id."), { code: "invalid_input" });

  const task = (await ctx.localDb.query<{
    id: string;
    workspace_id: string;
    created_by: string;
    start_url: string;
    page_limit: number;
    record_video: boolean;
    status: string;
  }>(
    "select id, workspace_id, created_by, start_url, page_limit, record_video, status from website_capture_tasks where id=$1",
    [taskId],
  )).rows[0];
  if (!task) throw Object.assign(new Error("Website capture task was not found."), { code: "invalid_input" });
  if (task.status === "canceled") throw Object.assign(new Error("Website capture was canceled."), { code: "job_canceled" });

  await ctx.localDb.query(
    "update website_capture_tasks set status='running', progress=1, stage='connecting', updated_at=now() where id=$1 and status in ('queued','failed')",
    [taskId],
  );
  await appendEvent(ctx, taskId, "connecting", "正在启动隔离浏览器");

  const onProgress = async (progress: number, stage: string, detail = "") => {
    await ctx.localDb!.query(
      "update website_capture_tasks set progress=$2, stage=$3, updated_at=now() where id=$1 and status='running'",
      [taskId, Math.max(0, Math.min(100, progress)), stage],
    );
    await appendEvent(ctx, taskId, stage, detail);
    await ctx.jobService.updateProgress(jobId, progress, stage);
  };

  try {
    const result = await captureIsolatedWebsite({
      db: ctx.localDb,
      storage: ctx.storage,
      storageRoot: ctx.env.storageRoot ?? "/www/helstera/uploads",
      webOrigin: ctx.env.webOrigin,
      task,
      onProgress,
    });
    await ctx.localDb.query(
      "update website_capture_tasks set status='succeeded', progress=100, stage='completed', result=$2::jsonb, error_message=null, completed_at=now(), updated_at=now() where id=$1 and status='running'",
      [taskId, JSON.stringify(result)],
    );
    await appendEvent(ctx, taskId, "completed", "网站介绍与素材已保存");
    return result as unknown as Record<string, unknown>;
  } catch (error) {
    const code = error instanceof WebsiteCaptureError ? error.code : ((error as { code?: string }).code ?? "executor_error");
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    await ctx.localDb.query(
      "update website_capture_tasks set status=case when status='canceled' then 'canceled' else 'failed' end, stage=case when status='canceled' then 'canceled' else 'failed' end, error_message=$2, updated_at=now() where id=$1 and status in ('queued','running')",
      [taskId, message],
    );
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
