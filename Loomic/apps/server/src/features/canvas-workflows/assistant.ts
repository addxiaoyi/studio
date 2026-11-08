import type { Pool } from "pg";
import {
  workflowAssistantPlanSchema,
  workflowProposalSchema,
  workflowGraphSchema,
  compileWorkflow,
  type WorkflowAssistantPlan,
  type WorkflowProposal,
} from "@helstera/shared";
import {
  CanvasWorkflowService,
  assertWorkflowCanvas,
  WorkflowError,
} from "./service.js";
import { AgentGoalService } from "../agent-goals/agent-goal-service.js";
import { assertWorkflowMaterials } from "./materials.js";

type ProposalRow = {
  id: string;
  canvas_id: string;
  workflow_id: string | null;
  revision: number | null;
  goal_id: string | null;
  goal_updated_at: Date | null;
  goal_status: string | null;
  session_id: string | null;
  prompt: string;
  action: WorkflowAssistantPlan["action"];
  summary: string;
  before_graph: unknown;
  graph: unknown;
  status: WorkflowProposal["status"];
  expires_at: Date;
  created_at: Date;
  result: Record<string, unknown> | null;
  request_key: string;
  workspace_id: string;
};
const view = (row: ProposalRow) =>
  workflowProposalSchema.parse({
    id: row.id,
    canvasId: row.canvas_id,
    workflowId: row.workflow_id,
    revision: row.revision,
    goalId: row.goal_id,
    prompt: row.prompt,
    action: row.action,
    summary: row.summary,
    before: row.before_graph,
    graph: row.graph,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    result: row.result,
  });
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export class WorkflowAssistantService {
  constructor(private readonly db: Pool) {}
  async request(userId:string,canvasId:string,requestKey:string){
    await assertWorkflowCanvas(this.db,userId,canvasId);
    const row=(await this.db.query<ProposalRow>("select * from canvas_workflow_proposals where canvas_id=$1 and created_by=$2 and request_key=$3",[canvasId,userId,requestKey])).rows[0];
    return row?view(row):null;
  }
  async list(userId: string, canvasId: string, workflowId?: string) {
    await assertWorkflowCanvas(this.db, userId, canvasId);
    const rows = (
      await this.db.query<ProposalRow>(
        "select * from canvas_workflow_proposals where canvas_id=$1 and created_by=$2 and ($3::uuid is null or workflow_id=$3) order by created_at desc limit 30",
        [canvasId, userId, workflowId ?? null],
      )
    ).rows;
    return rows.reverse().map(view);
  }
  async get(userId: string, canvasId: string, id: string) {
    await assertWorkflowCanvas(this.db, userId, canvasId);
    const row = (
      await this.db.query<ProposalRow>(
        "select * from canvas_workflow_proposals where id=$1 and canvas_id=$2 and created_by=$3",
        [id, canvasId, userId],
      )
    ).rows[0];
    if (!row) throw new WorkflowError("这项 AI 操作不存在或无权查看。", 404);
    return view(row);
  }
  async context(userId: string, canvasId: string, workflowId?: string) {
    const workspaceId = await assertWorkflowCanvas(this.db, userId, canvasId),
      service = new CanvasWorkflowService(this.db);
    const workflow = workflowId
      ? await service.get(userId, canvasId, workflowId)
      : null;
    const goal = workflow?.activeGoalId
      ? await new AgentGoalService(this.db).get(
          userId,
          workspaceId,
          workflow.activeGoalId,
        )
      : null;
    return { workspaceId, workflow, goal };
  }
  async propose(
    userId: string,
    canvasId: string,
    input: {
      plan: WorkflowAssistantPlan;
      prompt: string;
      requestKey: string;
      workflowId?: string;
      revision?: number;
      sessionId?: string;
    },
  ) {
    const prior = (
      await this.db.query<ProposalRow>(
        "select * from canvas_workflow_proposals where canvas_id=$1 and created_by=$2 and request_key=$3",
        [canvasId, userId, input.requestKey],
      )
    ).rows[0];
    const { workspaceId, workflow, goal } = await this.context(
      userId,
      canvasId,
      input.workflowId,
    );
    if (prior) return view(prior);
    if (
      workflow &&
      input.revision !== undefined &&
      workflow.revision !== input.revision
    )
      throw new WorkflowError(
        "流程在 AI 规划期间发生变化，请重新生成方案。",
        409,
      );
    const plan = workflowAssistantPlanSchema.parse(input.plan);
    if (plan.action !== "edit" && plan.action !== "inspect" && !workflow)
      throw new WorkflowError("请先选择要操控的工作流。");
    if (plan.action === "edit" && !plan.graph)
      throw new WorkflowError("AI 没有提供可应用的节点方案。");
    if (plan.action !== "edit" && plan.graph)
      throw new WorkflowError("运行控制不能同时修改节点，请分两次确认。");
    if (
      plan.action === "edit" &&
      goal &&
      !["completed", "failed", "canceled"].includes(goal.status)
    )
      throw new WorkflowError(
        "当前流程还在执行，请先取消运行后再修改节点。",
        409,
      );
    if (plan.graph)
      await assertWorkflowMaterials(this.db, plan.graph, {
        canvasId,
        workspaceId,
        userId,
      });
    if (plan.action === "run") compileWorkflow(workflow!.graph);
    if (!["edit", "inspect", "run"].includes(plan.action) && !goal)
      throw new WorkflowError("当前流程还没有运行记录。");
    if (
      input.sessionId &&
      !(
        await this.db.query(
          "select id from chat_sessions where id=$1 and canvas_id=$2 and created_by=$3",
          [input.sessionId, canvasId, userId],
        )
      ).rows.length
    )
      throw new WorkflowError("对话不属于当前画布。", 403);
    const row = (
      await this.db.query<ProposalRow>(
        `insert into canvas_workflow_proposals(canvas_id,workspace_id,created_by,workflow_id,revision,goal_id,goal_updated_at,goal_status,session_id,prompt,action,summary,before_graph,graph,request_key,status,result)
      values($1,$2,$3,$4,$5,$6,(select updated_at from agent_goals where id=$6),(select status from agent_goals where id=$6),$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15::jsonb)
      on conflict(canvas_id,created_by,request_key) do update set request_key=excluded.request_key returning *`,
        [
          canvasId,
          workspaceId,
          userId,
          workflow?.id ?? null,
          workflow?.revision ?? null,
          goal?.id ?? null,
          input.sessionId ?? null,
          input.prompt.slice(0, 3000),
          plan.action,
          plan.summary,
          workflow ? JSON.stringify(workflow.graph) : null,
          plan.graph ? JSON.stringify(plan.graph) : null,
          input.requestKey,
          plan.action === "inspect" ? "applied" : "pending",
          plan.action === "inspect"
            ? JSON.stringify({
                status: goal?.status ?? "draft",
                completed:
                  goal?.executionSteps?.filter(
                    (step) => step.state === "succeeded",
                  ).length ?? 0,
              })
            : null,
        ],
      )
    ).rows[0]!;
    return view(row);
  }
  async decide(
    userId: string,
    canvasId: string,
    id: string,
    decision: "confirm" | "reject",
    executionEnabled: boolean,
  ) {
    const client = await this.db.connect();
    try {
      await client.query("begin");
      const workspaceId = await assertWorkflowCanvas(client, userId, canvasId);
      const row = (
        await client.query<ProposalRow>(
          "select * from canvas_workflow_proposals where id=$1 and canvas_id=$2 and created_by=$3 for update",
          [id, canvasId, userId],
        )
      ).rows[0];
      if (!row) throw new WorkflowError("AI 操作不存在。", 404);
      if (row.status !== "pending") {
        await client.query("commit");
        return view(row);
      }
      if (decision === "reject") {
        const rejected = (
          await client.query<ProposalRow>(
            "update canvas_workflow_proposals set status='rejected',updated_at=now() where id=$1 returning *",
            [id],
          )
        ).rows[0]!;
        await client.query("commit");
        return view(rejected);
      }
      if (row.expires_at.getTime() <= Date.now())
        throw new WorkflowError(
          "这项 AI 操作已过期，请重新生成；没有执行。",
          409,
        );
      const workflows = new CanvasWorkflowService(this.db);
      const current = row.workflow_id
        ? await workflows.get(userId, canvasId, row.workflow_id)
        : null;
      let receipt: Record<string, unknown>;
      if (row.action === "edit") {
        const graph = workflowGraphSchema.parse(row.graph);
        await assertWorkflowMaterials(client, graph, {
          canvasId,
          workspaceId,
          userId,
        });
        if (
          current &&
          current.revision === row.revision! + 1 &&
          same(workflowGraphSchema.parse(current.graph), graph)
        )
          receipt = {
            workflowId: current.id,
            revision: current.revision,
            reused: true,
          };
        else {
          const document = current
            ? await workflows.save(
                userId,
                canvasId,
                current.id,
                row.revision!,
                graph,
              )
            : await workflows.create(userId, canvasId, graph, row.id);
          receipt = { workflowId: document.id, revision: document.revision };
        }
      } else if (row.action === "run") {
        if (!executionEnabled)
          throw new WorkflowError("工作流执行服务尚未启用。", 503);
        const run = await workflows.run(
          userId,
          canvasId,
          row.workflow_id!,
          row.revision!,
          row.id,
          row.session_id ?? undefined,
        );
        receipt = { workflowId: row.workflow_id, ...run };
      } else {
        if (
          !current ||
          current.activeGoalId !== row.goal_id ||
          current.revision !== row.revision
        )
          throw new WorkflowError("目标运行已经改变，请重新检查。", 409);
        const goal = (
          await client.query<{ status: string }>(
            "select status from agent_goals where id=$1 and created_by=$2 for update",
            [row.goal_id, userId],
          )
        ).rows[0];
        if (!goal || goal.status !== row.goal_status)
          throw new WorkflowError(
            "任务状态已改变，请重新读取状态再操作。",
            409,
          );
        const changed = await new AgentGoalService(client).transition(
          userId,
          workspaceId,
          row.goal_id!,
          row.action as "pause" | "resume" | "cancel" | "retry",
        );
        receipt = {
          workflowId: current.id,
          goalId: changed.id,
          status: changed.status,
        };
      }
      const applied = (
        await client.query<ProposalRow>(
          "update canvas_workflow_proposals set status='applied',result=$2::jsonb,workflow_id=coalesce(workflow_id,$3::uuid),updated_at=now() where id=$1 returning *",
          [id, JSON.stringify(receipt), receipt.workflowId ?? null],
        )
      ).rows[0]!;
      await client.query("commit");
      return view(applied);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
