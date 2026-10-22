import type { Pool } from "pg";

export type RetryClaim = {
  id: string;
  background_job_id: string | null;
  status: "queued";
  mode: "isolated" | "local";
};

export async function claimWebsiteCaptureRetry(db: Pool, taskId: string, workspaceId: string, userId: string) {
  const { rows } = await db.query<RetryClaim>(
    `update website_capture_tasks
        set status='queued',progress=0,stage='queued',error_message=null,updated_at=now()
      where id=$1 and workspace_id=$2 and created_by=$3 and status='failed'
      returning id,background_job_id,status,mode`,
    [taskId, workspaceId, userId],
  );
  return rows[0] ?? null;
}
