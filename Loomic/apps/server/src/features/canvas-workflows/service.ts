import type { Pool, PoolClient } from "pg";
import {
  agentGoalCreateRequestSchema,
  compileWorkflow,
  workflowGraphSchema,
  workflowRunGraph,
  type WorkflowGraph,
  type WorkflowDocument,
} from "@helstera/shared";
import { AgentGoalService } from "../agent-goals/agent-goal-service.js";
import { executableGoalPlan } from "../agent-goals/goal-planner.js";
import { assertWorkflowMaterials } from "./materials.js";

type Store = Pick<Pool, "query">;
type WorkflowRow = {
  id: string;
  canvas_id: string;
  graph: WorkflowGraph;
  revision: number;
  active_goal_id: string | null;
  updated_at: Date;
};
export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}
const view = (row: WorkflowRow): WorkflowDocument => ({
  id: row.id,
  canvasId: row.canvas_id,
  graph: workflowGraphSchema.parse(row.graph),
  revision: row.revision,
  activeGoalId: row.active_goal_id,
  updatedAt: row.updated_at.toISOString(),
});

export async function assertWorkflowCanvas(
  db: Store,
  userId: string,
  canvasId: string,
): Promise<string> {
  const row = (
    await db.query<{ workspace_id: string }>(
      `select p.workspace_id from canvases c join projects p on p.id=c.project_id
    join workspace_members m on m.workspace_id=p.workspace_id where c.id=$1 and m.user_id=$2 and p.archived_at is null`,
      [canvasId, userId],
    )
  ).rows[0];
  if (!row) throw new WorkflowError("画布不存在或权限已撤销。", 404);
  return row.workspace_id;
}

export class CanvasWorkflowService {
  constructor(private readonly db: Pool) {}
  async list(userId: string, canvasId: string) {
    await assertWorkflowCanvas(this.db, userId, canvasId);
    return (
      await this.db.query<WorkflowRow>(
        "select * from canvas_workflows where canvas_id=$1 and created_by=$2 order by updated_at desc limit 50",
        [canvasId, userId],
      )
    ).rows.map(view);
  }
  async create(
    userId: string,
    canvasId: string,
    graph: WorkflowGraph,
    requestKey: string,
  ) {
    const workspace = await assertWorkflowCanvas(this.db, userId, canvasId);
    const parsed = workflowGraphSchema.parse(graph);
    const row = (
      await this.db.query<WorkflowRow>(
        `insert into canvas_workflows(canvas_id,workspace_id,created_by,graph,request_key)
      values($1,$2,$3,$4::jsonb,$5) on conflict(canvas_id,created_by,request_key) do update set request_key=excluded.request_key returning *`,
        [canvasId, workspace, userId, JSON.stringify(parsed), requestKey],
      )
    ).rows[0]!;
    return view(row);
  }
  async get(userId: string, canvasId: string, id: string) {
    await assertWorkflowCanvas(this.db, userId, canvasId);
    const row = (
      await this.db.query<WorkflowRow>(
        "select * from canvas_workflows where id=$1 and canvas_id=$2 and created_by=$3",
        [id, canvasId, userId],
      )
    ).rows[0];
    if (!row) throw new WorkflowError("工作流不存在。", 404);
    return view(row);
  }
  private async lock(
    client: PoolClient,
    userId: string,
    canvasId: string,
    id: string,
  ) {
    const workspaceId = await assertWorkflowCanvas(client, userId, canvasId);
    const row = (
      await client.query<WorkflowRow>(
        "select * from canvas_workflows where id=$1 and canvas_id=$2 and created_by=$3 for update",
        [id, canvasId, userId],
      )
    ).rows[0];
    if (!row) throw new WorkflowError("工作流不存在。", 404);
    return { row, workspaceId };
  }
  private async assertEditable(client: PoolClient, row: WorkflowRow) {
    if (!row.active_goal_id) return;
    const goal = (
      await client.query<{ status: string }>(
        "select status from agent_goals where id=$1",
        [row.active_goal_id],
      )
    ).rows[0];
    if (goal && !["completed", "failed", "canceled"].includes(goal.status))
      throw new WorkflowError(
        "流程尚未结束。请先暂停查看或取消运行，再修改节点。",
        409,
      );
  }
  async save(
    userId: string,
    canvasId: string,
    id: string,
    revision: number,
    graph: WorkflowGraph,
  ) {
    const parsed = workflowGraphSchema.parse(graph),
      client = await this.db.connect();
    try {
      await client.query("begin");
      const { row } = await this.lock(client, userId, canvasId, id);
      if (row.revision !== revision)
        throw new WorkflowError(
          "工作流已在其他窗口修改，请重新加载；本地草稿已保留。",
          409,
        );
      await this.assertEditable(client, row);
      const saved = (
        await client.query<WorkflowRow>(
          "update canvas_workflows set graph=$2::jsonb,revision=revision+1,active_goal_id=null,updated_at=now() where id=$1 returning *",
          [id, JSON.stringify(parsed)],
        )
      ).rows[0]!;
      await client.query("commit");
      return view(saved);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  async run(
    userId: string,
    canvasId: string,
    id: string,
    revision: number,
    requestKey: string,
    sessionId?: string,
    targetNodeId?: string,
  ) {
    const client = await this.db.connect();
    try {
      await client.query("begin");
      const { row, workspaceId } = await this.lock(
        client,
        userId,
        canvasId,
        id,
      );
      const prior = (
        await client.query<{ goal_id: string; revision: number; target_node_id: string | null }>(
          "select goal_id,revision,target_node_id from canvas_workflow_runs where workflow_id=$1 and request_key=$2",
          [id, requestKey],
        )
      ).rows[0];
      if (prior) {
        if (prior.revision !== revision || prior.target_node_id !== (targetNodeId ?? null))
          throw new WorkflowError("这次运行请求与已确认版本不一致。", 409);
        await client.query("commit");
        return { goalId: prior.goal_id, reused: true };
      }
      if (row.revision !== revision)
        throw new WorkflowError("流程版本已改变，请重新检查执行方案。", 409);
      await this.assertEditable(client, row);
      if (
        sessionId &&
        !(
          await client.query(
            "select id from chat_sessions where id=$1 and canvas_id=$2 and created_by=$3",
            [sessionId, canvasId, userId],
          )
        ).rows.length
      )
        throw new WorkflowError("聊天会话不属于当前画布。", 403);
      const executionGraph = workflowRunGraph(row.graph,targetNodeId);
      const compiled = compileWorkflow(executionGraph);
      await assertWorkflowMaterials(client, executionGraph, { canvasId, workspaceId, userId });
      const input = agentGoalCreateRequestSchema.parse({
        goal: row.graph.title,
        canvasId,
        ...(sessionId ? { chatSessionId: sessionId } : {}),
        executionMode: "isolated_browser",
        outputKind: "canvas",
        idempotencyKey: `workflow:${id}:${requestKey}`,
      });
      const service = new AgentGoalService(client, async () =>
        executableGoalPlan(compiled, input),
      );
      const goal = await service.create(userId, workspaceId, input);
      await service.confirm(userId, workspaceId, goal.id);
      await client.query(
        "insert into canvas_workflow_runs(workflow_id,goal_id,revision,graph,request_key,target_node_id) values($1,$2,$3,$4::jsonb,$5,$6)",
        [id, goal.id, revision, JSON.stringify(executionGraph), requestKey, targetNodeId ?? null],
      );
      await client.query(
        "update canvas_workflows set active_goal_id=$2,updated_at=now() where id=$1",
        [id, goal.id],
      );
      await client.query("commit");
      return { goalId: goal.id, reused: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  async runs(userId: string, canvasId: string, id: string) {
    await this.get(userId, canvasId, id);
    return (
      await this.db.query(
        `select r.id,r.goal_id as "goalId",r.revision,r.graph,r.target_node_id as "targetNodeId",r.created_at as "createdAt",g.status
      from canvas_workflow_runs r join agent_goals g on g.id=r.goal_id where r.workflow_id=$1 order by r.created_at desc limit 20`,
        [id],
      )
    ).rows;
  }
}
