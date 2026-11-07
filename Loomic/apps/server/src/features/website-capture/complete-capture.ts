import type { Pool } from "pg";
import type { WebsiteCaptureResult } from "@helstera/shared";

export async function completeWebsiteCapture(db: Pool, taskId: string, result: WebsiteCaptureResult): Promise<boolean> {
  const screenshots = result.pages.map((page, index) => `[页面截图 ${index + 1}](${page.screenshotUrl})`).join("\n");
  const recording = result.recordingUrl ? `[${result.presentation?"网站介绍演示（多光标重建）":"网站录屏"}](${result.recordingUrl})` : "";
  const content = [recording, screenshots, result.introduction || "网站浏览已完成。"].filter(Boolean).join("\n\n").slice(0, 12000);
  const completed = await db.query(
    `with completed as (
       update website_capture_tasks
          set status='succeeded', progress=100, stage='completed', result=$2::jsonb,
              error_message=null, completed_at=now(), updated_at=now()
        where id=$1 and status='running'
        returning session_id, created_by
     ), message as (
       insert into chat_messages(session_id,role,content,client_message_id)
       select cs.id,'assistant',$3,$4 from completed t
       join chat_sessions cs on cs.id=t.session_id and cs.created_by=t.created_by
       on conflict (session_id,client_message_id) do nothing returning id
     )
     select session_id from completed`,
    [taskId, JSON.stringify(result), content, `website-capture:${taskId}:completed`],
  );
  return completed.rows.length === 1;
}
