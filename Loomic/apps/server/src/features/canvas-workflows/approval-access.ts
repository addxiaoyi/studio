import type { Pool } from "pg";
import type { GenerationApprovalRequest } from "../generation/generation-approval-service.js";
import type { WorkflowGraph } from "@helstera/shared";
import { assertWorkflowMaterials } from "./materials.js";
import { assertWorkflowReferenceAssets } from "./reference-access.js";
export class WorkflowApprovalBlocked extends Error {}

export async function assertWorkflowGenerationActive(
  db: Pool,
  approval: Pick<GenerationApprovalRequest, "model" | "parameters" | "context">,
) {
  const { workflowGoalId, workflowStepId } = approval.context ?? {};
  if (!workflowGoalId && !workflowStepId) return;
  const row = (
    await db.query<{
      workspace_id: string;
      created_by: string;
      canvas_id: string;
      graph: WorkflowGraph | null;
    }>(
      `select g.workspace_id,g.created_by,g.canvas_id,r.graph from agent_goals g join agent_goal_steps s on s.goal_id=g.id
    join canvases c on c.id=g.canvas_id join projects p on p.id=c.project_id join workspace_members m on m.workspace_id=p.workspace_id and m.user_id=g.created_by
    left join canvas_workflow_runs r on r.goal_id=g.id
    where g.id=$1 and s.id=$2 and g.status in ('running','waiting_approval','waiting_desktop') and s.state in ('running','waiting_desktop') and p.archived_at is null
      and s.executor='media.generate' and s.command->>'model'=$3`,
      [workflowGoalId, workflowStepId, approval.model],
    )
  ).rows[0];
  if (!row)
    throw new WorkflowApprovalBlocked(
      "对应工作流已暂停、取消或权限已撤销，本次费用确认已停止。",
    );
  const scope = {
    workspaceId: row.workspace_id,
    userId: row.created_by,
    canvasId: row.canvas_id,
  };
  try {
    if (row.graph) await assertWorkflowMaterials(db, row.graph, scope);
    const ids = approval.parameters.input_asset_ids;
    if (ids !== undefined) {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
        throw new Error("参考素材参数无效。");
      await assertWorkflowReferenceAssets(db, scope, ids);
    }
  } catch (cause) {
    throw new WorkflowApprovalBlocked(
      cause instanceof Error
        ? cause.message
        : "参考素材不可用，费用确认已停止。",
    );
  }
}

export async function assertWorkflowJobGenerationActive(
  db: Pool,
  input: { jobId: string; stepId: string; workspaceId: string; userId: string },
) {
  let row = (
    await db.query<{
      model: string;
      payload: Record<string, unknown>;
      context: GenerationApprovalRequest["context"];
    }>(
      `select model,payload,context from generation_approvals
     where job_id=$1 and workspace_id=$2 and user_id=$3 and status='approved' and consumed_at is not null
       and context->>'workflowStepId'=$4 and payload->>'workflow_step_id'=$4`,
      [input.jobId, input.workspaceId, input.userId, input.stepId],
    )
  ).rows[0];
  if (!row) {
    // A worker can observe the reserved credit receipt just before HTTP links the quote.
    row = (
      await db.query<{
        model: string;
        payload: Record<string, unknown>;
        context: GenerationApprovalRequest["context"];
      }>(
        `update generation_approvals a set job_id=j.id,consumed_at=coalesce(a.consumed_at,now())
       from background_jobs j where j.id=$1 and j.workspace_id=$2 and j.created_by=$3
         and a.workspace_id=j.workspace_id and a.user_id=j.created_by and a.job_id is null and a.status='approved'
         and j.idempotency_key='approval:'||a.id::text and j.payload=a.payload
         and a.context->>'workflowStepId'=$4 and a.payload->>'workflow_step_id'=$4
         and (a.estimated_credits=0 or (j.credits_transaction_id is not null and j.credits_cost=a.estimated_credits))
       returning a.model,a.payload,a.context`,
        [input.jobId, input.workspaceId, input.userId, input.stepId],
      )
    ).rows[0];
  }
  if (!row)
    throw new WorkflowApprovalBlocked(
      "工作流生成缺少对应的已消费费用确认，未调用模型。",
    );
  await assertWorkflowGenerationActive(db, {
    model: row.model,
    parameters: row.payload,
    ...(row.context ? { context: row.context } : {}),
  });
}
