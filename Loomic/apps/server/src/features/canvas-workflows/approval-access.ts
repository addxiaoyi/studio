import type { Pool } from "pg";
import type { GenerationApprovalRequest } from "../generation/generation-approval-service.js";
export class WorkflowApprovalBlocked extends Error {}

export async function assertWorkflowGenerationActive(
  db: Pool,
  approval: GenerationApprovalRequest,
) {
  const { workflowGoalId, workflowStepId } = approval.context ?? {};
  if (!workflowGoalId && !workflowStepId) return;
  const row = (
    await db.query(
      `select g.id from agent_goals g join agent_goal_steps s on s.goal_id=g.id
    join canvases c on c.id=g.canvas_id join projects p on p.id=c.project_id join workspace_members m on m.workspace_id=p.workspace_id and m.user_id=g.created_by
    where g.id=$1 and s.id=$2 and g.status in ('running','waiting_approval','waiting_desktop') and s.state in ('running','waiting_desktop') and p.archived_at is null
      and s.executor='media.generate' and s.command->>'model'=$3`,
      [workflowGoalId, workflowStepId, approval.model],
    )
  ).rows[0];
  if (!row)
    throw new WorkflowApprovalBlocked("对应工作流已暂停、取消或权限已撤销，本次费用确认已停止。");
}
