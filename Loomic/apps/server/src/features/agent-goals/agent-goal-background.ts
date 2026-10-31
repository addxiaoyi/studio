import type { Pool } from "pg";

import type { DesktopAgentTaskRequest } from "@helstera/shared";

import type { StorageProvider } from "../../storage/storage-provider.js";
import { insertLocalImageElement, insertLocalVideoElement } from "../canvas/canvas-element-writer.js";
import { captureIsolatedWebsite } from "../website-capture/isolated-browser.js";
import type { BackgroundGoalExecutor } from "./agent-goal-worker.js";

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
    const startUrl = request.targetUrl;
    if (!startUrl) {
      throw new Error(
        "A public URL is required for automatic or isolated browser goals.",
      );
    }

    const recordVideo = /\b(record|录制|录像)\b/i.test(goal.goal);
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
        `agent-goal:${goal.id}`,
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

      await options.db.query(
        "update website_capture_tasks set status='succeeded',progress=100,stage='completed',result=$2::jsonb,completed_at=now(),updated_at=now() where id=$1 and status='running'",
        [taskId, JSON.stringify(capture)],
      );

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
          })
        : [];

      return {
        summary: capture.introduction,
        sourceUrl: capture.startUrl,
        assets,
        evidence,
        ...(canvasElementIds.length ? { canvasElementIds } : {}),
      } satisfies Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await options.db.query(
        "update website_capture_tasks set status='failed',stage='failed',error_message=$2,updated_at=now() where id=$1 and status='running'",
        [taskId, message.slice(0, 1_000)],
      );
      throw error;
    }
  };
}

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
}) {
  const imageAssetIds = input.pages.map((page) => page.assetId).filter(Boolean);
  const assetIds = [...new Set([...imageAssetIds, input.recordingAssetId].filter(Boolean))] as string[];
  if (!assetIds.length) return [];
  const { rows } = await input.db.query<{ id: string; object_path: string; mime_type: string | null }>(
    `select id,object_path,mime_type from generated_assets
      where id=any($1::uuid[]) and workspace_id=$2 and deleted_at is null`,
    [assetIds, input.workspaceId],
  );
  const assets = new Map(rows.map((row) => [row.id, row]));
  const elementIds: string[] = [];
  for (const [index, page] of input.pages.entries()) {
    const asset = assets.get(page.assetId);
    if (!asset) continue;
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
