import type { Pool } from "pg";

import type { DesktopAgentTaskRequest } from "@helstera/shared";

import type { StorageProvider } from "../../storage/storage-provider.js";
import { captureIsolatedWebsite } from "../website-capture/isolated-browser.js";
import type { BackgroundGoalExecutor } from "./agent-goal-worker.js";

type BackgroundGoalOptions = {
  db: Pool;
  storage: StorageProvider;
  storageRoot: string;
  webOrigin: string;
};

export function createBackgroundGoalExecutor(
  options: BackgroundGoalOptions,
): BackgroundGoalExecutor {
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

      return {
        summary: capture.introduction,
        sourceUrl: capture.startUrl,
        assets,
        evidence,
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
