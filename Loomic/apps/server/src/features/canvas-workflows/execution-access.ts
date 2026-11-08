import type { Pool } from "pg";
import type { StepExecutor } from "../agent-goals/goal-step-worker.js";
import type { WorkflowGraph } from "@helstera/shared";
import { assertWorkflowMaterials } from "./materials.js";

export function guardWorkflowExecution(
  db: Pool,
  execute: StepExecutor,
): StepExecutor {
  return async (input) => {
    const assertActive = async () => {
      await input.assertActive();
      const row = (
        await db.query<{ allowed: boolean; graph: WorkflowGraph }>(
          `select exists(select 1 from canvas_workflows w
        join canvases c on c.id=w.canvas_id join projects p on p.id=c.project_id
        join workspace_members m on m.workspace_id=p.workspace_id and m.user_id=w.created_by
        where w.id=r.workflow_id and w.created_by=$2 and p.archived_at is null) as allowed,r.graph
        from canvas_workflow_runs r where r.goal_id=$1`,
          [input.goal.id, input.goal.created_by],
        )
      ).rows[0];
      if (row && !row.allowed)
        throw new Error("工作流画布访问权限已撤销，执行已停止。");
      if (row?.graph) await assertWorkflowMaterials(db, row.graph, { canvasId: input.goal.canvas_id, workspaceId: input.goal.workspace_id, userId: input.goal.created_by });
    };
    await assertActive();
    return execute({ ...input, assertActive });
  };
}
