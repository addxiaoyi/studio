import type { Pool } from "pg";

import type { StorageProvider } from "../../storage/storage-provider.js";
import { insertLocalImageElement, insertLocalVideoElement } from "../canvas/canvas-element-writer.js";
import { captureIsolatedWebsite } from "../website-capture/isolated-browser.js";
import type { BackgroundGoalExecutor } from "./agent-goal-worker.js";
import { buildWebsiteDocument } from "./agent-goal-document.js";
import { ReadOnlyGoalPausedError } from "./agent-goal-interruption.js";
import { assertConnectorEnabled } from "./connector-gate.js";

type BackgroundGoalOptions = {
  db: Pool;
  storage: StorageProvider;
  storageRoot: string;
  webOrigin: string;
  canvasWriter?: {
    insertImage: typeof insertLocalImageElement;
    insertVideo: typeof insertLocalVideoElement;
  };
};

type CaptureCanvasWriter = NonNullable<BackgroundGoalOptions["canvasWriter"]>;

export function createBackgroundGoalExecutor(
  options: BackgroundGoalOptions,
): BackgroundGoalExecutor {
  const canvasWriter: CaptureCanvasWriter = options.canvasWriter ?? {
    insertImage: insertLocalImageElement,
    insertVideo: insertLocalVideoElement,
  };
  return async ({ taskId, goal, request }) => {
    const assertActive = async () => {
      await assertConnectorEnabled(options.db, goal.workspace_id, goal.created_by, "isolated-browser");
      const { rows } = await options.db.query<{ status: string; task_status: string }>(
        `select g.status,t.status as task_status from agent_goals g join desktop_agent_tasks t on t.goal_id=g.id
         where g.id=$1 and t.id=$2`,
        [goal.id, taskId],
      );
      const current = rows[0];
      if (current?.status === "running" && current.task_status === "running") return;
      if (current && ["running", "paused"].includes(current.status) && ["running", "paused"].includes(current.task_status)) {
        throw new ReadOnlyGoalPausedError();
      }
      throw new InactiveGoalError("The goal is no longer running; capture writeback stopped.");
    };
    const startUrl = request.targetUrl;
    if (!startUrl) {
      throw new Error(
        "A public URL is required for automatic or isolated browser goals.",
      );
    }

    await assertActive();
    const recordVideo = /\brecord\b|录制|录像|录屏/i.test(goal.goal);
    if (recordVideo || goal.output_kind === "video") {
      throw new Error("Recording requires an exact action approval. Use the desktop task approval flow; background website reports are read-only.");
    }
    await options.db.query(
      `insert into website_capture_tasks
        (id,workspace_id,created_by,session_id,mode,start_url,page_limit,record_video,follow_external,idempotency_key,status,stage)
       values($1,$2,$3,$4,'isolated',$5,$6,$7,false,$8,'running','connecting')`,
      [
        taskId,
        goal.workspace_id,
        goal.created_by,
        goal.chat_session_id,
        startUrl,
        request.pageLimit,
        recordVideo,
        `agent-goal:${goal.id}:${taskId}`,
      ],
    );

    try {
      const capture = await captureIsolatedWebsite({
        db: options.db,
        storage: options.storage,
        storageRoot: options.storageRoot,
        webOrigin: options.webOrigin,
        task: {
          id: taskId,
          workspace_id: goal.workspace_id,
          created_by: goal.created_by,
          start_url: startUrl,
          page_limit: request.pageLimit,
          record_video: recordVideo,
          follow_external: false,
        },
        onProgress: async (progress, stage, detail) => {
          await assertActive();
          await options.db.query(
            "update website_capture_tasks set progress=$2,stage=$3,updated_at=now() where id=$1 and status='running'",
            [taskId, progress, stage],
          );
          await options.db.query(
            "insert into agent_goal_events(goal_id,task_id,event_type,detail,payload) values($1,$2,'goal.task_progress',$3,$4::jsonb)",
            [
              goal.id,
              taskId,
              detail ?? stage,
              JSON.stringify({ progress, stage }),
            ],
          );
        },
      });

      await assertActive();
      const documents = ["auto", "canvas", "document", "bundle"].includes(goal.output_kind)
        ? [buildWebsiteDocument(goal.id, capture)]
        : [];

      const assets: Array<{
        id: string;
        url: string;
        mediaType: "image" | "video";
      }> = capture.pages.flatMap((page) =>
        page.assetId && page.screenshotUrl
          ? [
              {
                id: page.assetId,
                url: page.screenshotUrl,
                mediaType: "image" as const,
              },
            ]
          : [],
      );
      const evidence: Array<{
        kind: "screenshot" | "recording";
        sourceUrl: string;
        title: string;
        assetId?: string;
      }> = capture.pages.map((page) => ({
        kind: "screenshot" as const,
        sourceUrl: page.url,
        title: page.title,
        assetId: page.assetId,
      }));
      if (capture.recordingAssetId && capture.recordingUrl) {
        assets.push({
          id: capture.recordingAssetId,
          url: capture.recordingUrl,
          mediaType: "video",
        });
        evidence.push({
          kind: "recording",
          sourceUrl: capture.startUrl,
          title: "Website recording",
          assetId: capture.recordingAssetId,
        });
      }

      const canvasElementIds = goal.canvas_id
        ? await writeCaptureToCanvas({
            db: options.db,
            storage: options.storage,
            writer: canvasWriter,
            canvasId: goal.canvas_id,
            taskId,
            workspaceId: goal.workspace_id,
            pages: capture.pages,
            recordingAssetId: capture.recordingAssetId,
            recordingUrl: capture.recordingUrl,
            beforeWrite: assertActive,
          })
        : [];

      await assertActive();
      await options.db.query(
        "update website_capture_tasks set status='succeeded',progress=100,stage='completed',result=$2::jsonb,completed_at=now(),updated_at=now() where id=$1 and status='running'",
        [taskId, JSON.stringify(capture)],
      );
      return {
        summary: capture.introduction,
        documents,
        sourceUrl: capture.startUrl,
        assets,
        evidence,
        ...(canvasElementIds.length ? { canvasElementIds } : {}),
      } satisfies Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await options.db.query(
        "update website_capture_tasks set status=$3,stage=$3,error_message=$2,updated_at=now() where id=$1 and status='running'",
        [taskId, message.slice(0, 1_000), error instanceof InactiveGoalError || error instanceof ReadOnlyGoalPausedError ? "canceled" : "failed"],
      );
      throw error;
    }
  };
}

class InactiveGoalError extends Error {}

export async function writeCaptureToCanvas(input: {
  db: Pool;
  storage: StorageProvider;
  writer: CaptureCanvasWriter;
  canvasId: string;
  taskId: string;
  workspaceId: string;
  pages: Array<{ assetId: string; title: string }>;
  recordingAssetId?: string | undefined;
  recordingUrl?: string | undefined;
  beforeWrite?: () => Promise<void>;
}) {
  const imageAssetIds = input.pages.map((page) => page.assetId).filter(Boolean);
  const assetIds = [...new Set([...imageAssetIds, input.recordingAssetId].filter(Boolean))] as string[];
  if (!assetIds.length) return [];
  const { rows } = await input.db.query<{ id: string; object_path: string; mime_type: string | null }>(
    `select coalesce(ao.id,ga.id) as id,ga.object_path,ga.mime_type from generated_assets ga
      left join asset_objects ao on ao.workspace_id=ga.workspace_id and ao.object_path=ga.object_path
      where (ga.id=any($1::uuid[]) or ao.id=any($1::uuid[])) and ga.workspace_id=$2 and ga.deleted_at is null
        and ga.retention_state='active' and ga.retention_until>now()`,
    [assetIds, input.workspaceId],
  );
  const assets = new Map(rows.map((row) => [row.id, row]));
  if (assetIds.some(id => !assets.has(id))) throw new Error("结果素材已删除、到期或不属于当前工作区，未写入画布。");
  const elementIds: string[] = [];
  for (const [index, page] of input.pages.entries()) {
    const asset = assets.get(page.assetId);
    if (!asset) continue;
    await input.beforeWrite?.();
    const inserted = await input.writer.insertImage(input.db, input.storage, {
      canvasId: input.canvasId,
      objectPath: asset.object_path,
      width: 1280,
      height: 720,
      mimeType: asset.mime_type ?? "image/jpeg",
      title: `网站捕获截图 ${index + 1}：${page.title}`,
      assetId: page.assetId,
      jobId: `${input.taskId}:screenshot:${page.assetId}`,
    });
    elementIds.push(inserted.elementId);
  }
  if (input.recordingAssetId && input.recordingUrl) {
    await input.beforeWrite?.();
    const inserted = await input.writer.insertVideo(input.db, {
      canvasId: input.canvasId,
      signedUrl: input.recordingUrl,
      width: 1280,
      height: 720,
      mimeType: "video/webm",
      title: "网站捕获浏览录屏",
      assetId: input.recordingAssetId,
      jobId: `${input.taskId}:recording:${input.recordingAssetId}`,
    });
    elementIds.push(inserted.elementId);
  }
  return elementIds;
}
