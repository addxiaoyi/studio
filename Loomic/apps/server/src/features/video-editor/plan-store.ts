import type { Pool } from "pg";
import type { VideoEditorExportReceipt, VideoEditorPlan, VideoEditorPlanRequest } from "@helstera/shared";
import { fingerprintPayload } from "../generation/generation-approval-service.js";

export class EditorApprovalError extends Error {}

export function createEditorPlanStore(db: Pool) {
  return {
    async save(userId: string, workspaceId: string, input: VideoEditorPlanRequest, plan: VideoEditorPlan) {
      if (!input.revision || !input.compositionId) throw new EditorApprovalError("请升级编辑器并选择当前合成后重试。");
      const fingerprint = fingerprintPayload({ plan, revision: input.revision, compositionId: input.compositionId, credits: 0 });
      const saved = await db.query<{ id: string; expires_at: Date }>(
        `insert into video_editor_plans(user_id, workspace_id, composition_id, revision, plan, fingerprint)
         values($1,$2,$3,$4,$5::jsonb,$6) returning id, expires_at`,
        [userId, workspaceId, input.compositionId, input.revision, JSON.stringify(plan), fingerprint],
      );
      const row = saved.rows[0];
      if (!row) throw new EditorApprovalError("编辑计划保存失败，请重试。");
      return { id: row.id, fingerprint, expiresAt: row.expires_at.toISOString(), estimatedCredits: 0 as const };
    },
    async confirm(userId: string, id: string, input: { revision: string; fingerprint: string; actions: number[] }) {
      const actions = [...input.actions].sort((a, b) => a - b);
      if (!actions.length || actions.some((index, position) => !Number.isSafeInteger(index) || index !== position)) {
        throw new EditorApprovalError("请逐项确认全部动作，不能包含重复或越界的动作编号。");
      }
      const row = await db.query<{ plan: VideoEditorPlan; composition_id: string }>(
        `update video_editor_plans set status = 'approved', confirmed_at = coalesce(confirmed_at, now())
         where id = $1 and user_id = $2 and revision = $3 and fingerprint = $4
           and status in ('pending','approved') and expires_at > now()
           and editor_applied_at is null
           and jsonb_array_length(plan->'actions') = $5
         returning plan, composition_id`, [id, userId, input.revision, input.fingerprint, actions.length],
      );
      if (!row.rows[0]) throw new EditorApprovalError("计划已过期、参数已改变或尚未逐项确认，请重新预览。");
      return { id, plan: row.rows[0].plan, compositionId: row.rows[0].composition_id };
    },
    async complete(userId: string, id: string, fingerprint: string, output?: VideoEditorExportReceipt) {
      const receipt = await db.query(`update video_editor_plans set
        editor_applied_at = coalesce(editor_applied_at, now()),
        export_receipt = coalesce(export_receipt, $4::jsonb),
        status = case when not (plan->'actions' @> '[{"type":"export"}]'::jsonb) or coalesce(export_receipt, $4::jsonb) is not null then 'completed' else 'approved' end,
        completed_at = case when not (plan->'actions' @> '[{"type":"export"}]'::jsonb) or coalesce(export_receipt, $4::jsonb) is not null then coalesce(completed_at, now()) else null end
        where id=$1 and user_id=$2 and fingerprint=$3 and status in ('approved','completed')
          and ($4::jsonb is null or (editor_applied_at is not null and plan->'actions' @> '[{"type":"export"}]'::jsonb))
          and (export_receipt is null or $4::jsonb is null or export_receipt = $4::jsonb)
        returning id`, [id, userId, fingerprint, output ? JSON.stringify(output) : null]);
      if (!receipt.rowCount) throw new EditorApprovalError("找不到已确认的编辑计划。");
    },
  };
}

export type EditorPlanStore = ReturnType<typeof createEditorPlanStore>;
