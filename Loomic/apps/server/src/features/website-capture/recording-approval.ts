import type { Pool } from "pg";

type Approval = {
  id: string;
  task_id: string;
  action: Record<string, unknown>;
  expires_at: string | Date;
  status: "pending" | "approved";
};

// Build from the stored task both when requesting and consuming approval.
const taskAction = `(jsonb_build_object(
  'kind', 'website_recording', 'url', t.start_url, 'mode', t.mode,
  'pageLimit', t.page_limit, 'followExternal', t.follow_external,
  'sessionId', t.session_id, 'connectionId', t.assistant_connection_id
) || case when to_jsonb(t)->'presentation' is not null and to_jsonb(t)->'presentation' <> 'null'::jsonb
  then jsonb_build_object('presentation',to_jsonb(t)->'presentation') else '{}'::jsonb end)`;

export function recordingActionFromTask(task: {
  start_url: string;
  mode: string;
  page_limit: number;
  follow_external: boolean;
  session_id: string | null;
  assistant_connection_id: string | null;
  presentation?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    kind: "website_recording",
    url: task.start_url,
    mode: task.mode,
    pageLimit: task.page_limit,
    followExternal: task.follow_external,
    sessionId: task.session_id,
    connectionId: task.assistant_connection_id,
    ...(task.presentation?{presentation:task.presentation}:{}),
  };
}

export async function requestRecordingApproval(db: Pool, taskId: string, workspaceId: string, userId: string): Promise<Approval> {
  const client = await db.connect();
  try {
  await client.query("begin");
  const task = await client.query<{ id: string }>(
    `select id from website_capture_tasks where id=$1 and workspace_id=$2 and created_by=$3
      and record_video=true and status='queued' and stage in ('queued','waiting_recording_approval')
      and background_job_id is null for update`,
    [taskId, workspaceId, userId],
  );
  if (!task.rows[0]) throw new Error("Recording approval cannot be requested while the task is dispatching or has ended.");
  await client.query(
    `update website_recording_approvals a set status='expired'
      from website_capture_tasks t
      where a.task_id=$1 and a.workspace_id=$2 and a.user_id=$3 and t.id=a.task_id
        and t.workspace_id=a.workspace_id and t.created_by=a.user_id
        and a.status in ('pending','approved') and (a.expires_at <= now() or a.action <> ${taskAction})`,
    [taskId, workspaceId, userId],
  );
  const { rows } = await client.query<Approval>(
    `insert into website_recording_approvals(task_id, workspace_id, user_id, action)
     select t.id, t.workspace_id, t.created_by, ${taskAction}
       from website_capture_tasks t
      where t.id=$1 and t.workspace_id=$2 and t.created_by=$3 and t.record_video=true and t.status='queued'
     on conflict (task_id) where status in ('pending','approved') do nothing
     returning id,task_id,action,expires_at,status`,
    [taskId, workspaceId, userId],
  );
  if (rows[0]) { await client.query("commit"); return rows[0]; }
  const existing = await client.query<Approval>(
    `select a.id,a.task_id,a.action,a.expires_at,a.status from website_recording_approvals a
     join website_capture_tasks t on t.id=a.task_id
     where a.task_id=$1 and a.workspace_id=$2 and a.user_id=$3 and a.status in ('pending','approved')
       and a.expires_at>now() and t.status='queued' and t.record_video=true and a.action=${taskAction}`,
    [taskId, workspaceId, userId],
  );
  if (!existing.rows[0]) throw new Error("Recording approval could not be requested for this task.");
  await client.query("commit");
  return existing.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function decideRecordingApproval(db: Pool, approvalId: string, workspaceId: string, userId: string, approve: boolean): Promise<boolean> {
  const status = approve ? "approved" : "rejected";
  const { rows } = await db.query<{ id: string }>(
    `with locked as (
      select t.id from website_capture_tasks t
      join website_recording_approvals a on a.task_id=t.id
      where a.id=$1 and a.workspace_id=$2 and a.user_id=$3 and t.workspace_id=$2 and t.created_by=$3
        and t.status='queued' and t.record_video=true and t.stage in ('queued','waiting_recording_approval')
        and t.background_job_id is null for update of t
    ), decided as (
     update website_recording_approvals a set status=$4,
       approved_at=case when $4='approved' then now() else null end,
       rejected_at=case when $4='rejected' then now() else null end
     from website_capture_tasks t, locked
     where a.id=$1 and a.workspace_id=$2 and a.user_id=$3 and a.status='pending'
       and a.expires_at>now() and t.id=a.task_id and t.workspace_id=a.workspace_id
       and t.id=locked.id and t.created_by=a.user_id and a.action=${taskAction}
     returning a.id,a.task_id
    ), marked as (
      update website_capture_tasks t set stage=case when $4='approved' then 'recording_dispatching' else 'canceled' end,
        status=case when $4='approved' then 'queued' else 'canceled' end,updated_at=now()
      from decided where t.id=decided.task_id returning t.id
    ) select decided.id from decided join marked on marked.id=decided.task_id`,
    [approvalId, workspaceId, userId, status],
  );
  return rows.length === 1;
}

export async function consumeRecordingApproval(db: Pool, approvalId: string, taskId: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `update website_recording_approvals a set status='consumed', consumed_at=now()
     from website_capture_tasks t
     where a.id=$1 and a.task_id=$2 and a.status='approved' and a.expires_at>now()
       and t.id=a.task_id and t.workspace_id=a.workspace_id and t.created_by=a.user_id
       and t.status='queued' and t.record_video=true and a.action=${taskAction}
     returning a.id`,
    [approvalId, taskId],
  );
  return rows.length === 1;
}

export async function claimApprovedRecording(db: Pool, taskId: string, action: Record<string, unknown>, approvalId?: string): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const locked = await client.query<{ id: string }>(
      `select t.id from website_capture_tasks t where t.id=$1 and t.status='queued' and t.record_video=true
        and ${taskAction}=$2::jsonb for update`,
      [taskId, JSON.stringify(action)],
    );
    if (!locked.rows[0]) {
      await client.query("rollback");
      return false;
    }
    const consumed = await client.query<{ id: string }>(
      `update website_recording_approvals a set status='consumed', consumed_at=now()
       from website_capture_tasks t
       where a.task_id=$1 and ($2::uuid is null or a.id=$2::uuid) and a.status='approved' and a.expires_at>now()
         and t.id=a.task_id and t.workspace_id=a.workspace_id and t.created_by=a.user_id
         and t.status='queued' and t.record_video=true and a.action=${taskAction}
       returning a.id`,
      [taskId, approvalId ?? null],
    );
    if (consumed.rows.length !== 1) {
      await client.query("rollback");
      return false;
    }
    const claimed = await client.query<{ id: string }>(
      "update website_capture_tasks set status='running', stage='connecting', progress=1, updated_at=now() where id=$1 and status='queued' returning id",
      [taskId],
    );
    if (!claimed.rows[0]) throw new Error("Recording task claim was lost after approval consumption.");
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
