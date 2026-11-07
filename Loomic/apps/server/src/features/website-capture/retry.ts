import type { Pool } from "pg";

export type RetryClaim = {
  id: string;
  background_job_id: string | null;
  status: "queued";
  mode: "isolated" | "local";
  record_video: boolean;
};

export async function claimWebsiteCaptureRetry(db: Pool, taskId: string, workspaceId: string, userId: string) {
  const { rows } = await db.query<RetryClaim>(
    `update website_capture_tasks
        set status='queued',progress=0,stage=case when record_video then 'waiting_recording_approval' else 'queued' end,
            background_job_id=case when record_video then null else background_job_id end,error_message=null,updated_at=now()
      where id=$1 and workspace_id=$2 and created_by=$3 and status='failed'
      returning id,background_job_id,status,mode,record_video`,
    [taskId, workspaceId, userId],
  );
  return rows[0] ?? null;
}
