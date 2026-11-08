import type { Pool } from "pg";
import type { StepExecutor } from "../agent-goals/goal-step-worker.js";

export function guardWorkflowExecution(
  db: Pool,
  execute: StepExecutor,
): StepExecutor {
  return async (input) => {
    const assertActive = async () => {
      await input.assertActive();
      const row = (
        await db.query<{ allowed: boolean }>(
          `select exists(select 1 from canvas_workflows w
        join canvases c on c.id=w.canvas_id join projects p on p.id=c.project_id
        join workspace_members m on m.workspace_id=p.workspace_id and m.user_id=w.created_by
        where w.id=r.workflow_id and w.created_by=$2 and p.archived_at is null) as allowed
        from canvas_workflow_runs r where r.goal_id=$1`,
          [input.goal.id, input.goal.created_by],
        )
      ).rows[0];
      if (row && !row.allowed)
        throw new Error("工作流画布访问权限已撤销，执行已停止。");
    };
    await assertActive();
    return execute({ ...input, assertActive });
  };
}
