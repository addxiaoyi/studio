import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import {
  agentGoalCreateRequestSchema,
  type AgentGoal,
  type AgentGoalCreateRequest,
  type AgentGoalPlan,
  type AgentGoalPlanStep,
  type AgentGoalStatus,
  type DesktopAgentExecutionMode,
} from "@helstera/shared";

type GoalRow = {
  id: string;
  workspace_id: string;
  created_by: string;
  canvas_id: string | null;
  chat_session_id: string | null;
  goal: string;
  status: AgentGoalStatus;
  plan: AgentGoalPlan;
  execution_mode: DesktopAgentExecutionMode;
  capabilities: string[];
  result: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
};

const nativeModes = new Set<DesktopAgentExecutionMode>(["windows_ui", "visual_ocr"]);
const approvalWords = /点击|输入|录制|上传|下载|发布|删除|购买|支付|付费|click|type|record|upload|publish|delete|purchase|payment/i;

export type AgentGoalTransition = "pause" | "resume" | "cancel" | "retry";

export class AgentGoalTransitionError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "AgentGoalTransitionError";
  }
}

export function buildAgentGoalPlan(goal: string, executionMode: DesktopAgentExecutionMode): AgentGoalPlan {
  const needsApproval = approvalWords.test(goal);
  const requiresDesktop = nativeModes.has(executionMode);
  const steps: AgentGoalPlanStep[] = [
    {
      id: "understand-context",
      title: "检查目标、画布和已授权上下文",
      status: "queued",
      risk: "read_only",
      requiresDesktop: false,
      requiresApproval: false,
    },
    {
      id: "execute-goal",
      title: requiresDesktop ? "在本机执行目标步骤" : "执行目标步骤并收集证据",
      status: "queued",
      risk: needsApproval ? "approval" : "automatic",
      requiresDesktop,
      requiresApproval: needsApproval,
    },
    {
      id: "return-results",
      title: "整理结果并回流画布、聊天和素材库",
      status: "queued",
      risk: "read_only",
      requiresDesktop: false,
      requiresApproval: false,
    },
  ];
  return { steps, generatedAt: new Date().toISOString() };
}

function iso(value: string | Date) {
  return new Date(value).toISOString();
}

export class AgentGoalService {
  constructor(private readonly db: Pool) {}

  async create(userId: string, workspaceId: string, rawInput: AgentGoalCreateRequest): Promise<AgentGoal> {
    const input = agentGoalCreateRequestSchema.parse(rawInput);
    await this.assertContext(userId, workspaceId, input);
    const plan = buildAgentGoalPlan(input.goal, input.executionMode);
    const goalId = randomUUID();
    const inserted = await this.db.query<{ id: string }>(
      `insert into agent_goals
        (id,workspace_id,created_by,canvas_id,chat_session_id,goal,status,plan,execution_mode,capabilities,attachments,idempotency_key)
       values($1,$2,$3,$4,$5,$6,'draft',$7::jsonb,$8,$9::jsonb,$10::jsonb,$11)
       on conflict (workspace_id,created_by,idempotency_key) do nothing
       returning id`,
      [
        goalId,
        workspaceId,
        userId,
        input.canvasId ?? null,
        input.chatSessionId ?? null,
        input.goal,
        JSON.stringify(plan),
        input.executionMode,
        JSON.stringify(input.capabilities),
        JSON.stringify(input.attachments),
        input.idempotencyKey,
      ],
    );
    const actualId = inserted.rows[0]?.id ?? (await this.db.query<{ id: string }>(
      "select id from agent_goals where workspace_id=$1 and created_by=$2 and idempotency_key=$3",
      [workspaceId, userId, input.idempotencyKey],
    )).rows[0]?.id;
    if (!actualId) throw new Error("Unable to create Agent goal.");
    if (inserted.rows[0]) {
      await this.db.query(
        `insert into agent_goal_events(goal_id,event_type,detail,payload)
         values($1,'goal.created','目标已创建',$2::jsonb),($1,'goal.plan_ready','执行计划已生成',$3::jsonb)`,
        [actualId, JSON.stringify({ goal: input.goal }), JSON.stringify(plan)],
      );
    }
    return this.get(userId, workspaceId, actualId);
  }

  async list(userId: string, workspaceId: string): Promise<AgentGoal[]> {
    const rows = await this.db.query<{ id: string }>(
      "select id from agent_goals where created_by=$1 and workspace_id=$2 order by updated_at desc limit 50",
      [userId, workspaceId],
    );
    return Promise.all(rows.rows.map((row) => this.get(userId, workspaceId, row.id)));
  }

  async get(userId: string, workspaceId: string, goalId: string): Promise<AgentGoal> {
    const goal = await this.db.query<GoalRow>(
      `select id,workspace_id,created_by,canvas_id,chat_session_id,goal,status,plan,execution_mode,capabilities,result,error_message,created_at,updated_at,completed_at
         from agent_goals where id=$1 and created_by=$2 and workspace_id=$3`,
      [goalId, userId, workspaceId],
    );
    const row = goal.rows[0];
    if (!row) throw new Error("Agent goal not found.");
    const [tasks, activities, approvals] = await Promise.all([
      this.db.query(
        `select id as "taskId",goal_id as "goalId",parent_task_id as "parentTaskId",goal,role,execution_mode as "executionMode",capabilities,status,checkpoint,"wait_reason" as "waitReason",result,error_message as error,created_at as "createdAt",updated_at as "updatedAt"
           from desktop_agent_tasks where goal_id=$1 order by created_at asc`,
        [goalId],
      ),
      this.db.query(
        `select id,task_id as "taskId",event_type as "eventType",detail,payload,created_at as "createdAt"
           from agent_goal_events where goal_id=$1 order by created_at desc limit 100`,
        [goalId],
      ),
      this.db.query(
        `select a.id as "approvalId",a.task_id as "taskId",a.action,a.status,a.expires_at as "expiresAt"
           from desktop_agent_approvals a join desktop_agent_tasks t on t.id=a.task_id
          where t.goal_id=$1 order by a.created_at desc limit 50`,
        [goalId],
      ),
    ]);
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      createdBy: row.created_by,
      ...(row.canvas_id ? { canvasId: row.canvas_id } : {}),
      ...(row.chat_session_id ? { chatSessionId: row.chat_session_id } : {}),
      goal: row.goal,
      status: row.status,
      plan: row.plan,
      executionMode: row.execution_mode,
      capabilities: row.capabilities as AgentGoal["capabilities"],
      tasks: tasks.rows.map((task) => ({
        ...task,
        createdAt: iso(task.createdAt),
        updatedAt: iso(task.updatedAt),
      })),
      activities: activities.rows.map((activity) => ({
        ...activity,
        createdAt: iso(activity.createdAt),
      })),
      approvals: approvals.rows.map((approval) => ({
        ...approval,
        expiresAt: iso(approval.expiresAt),
      })),
      result: row.result,
      error: row.error_message,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      completedAt: row.completed_at ? iso(row.completed_at) : null,
    };
  }

  async transition(userId: string, workspaceId: string, goalId: string, transition: AgentGoalTransition) {
    const currentResult = await this.db.query<{ status: AgentGoalStatus }>(
      "select status from agent_goals where id=$1 and created_by=$2 and workspace_id=$3",
      [goalId, userId, workspaceId],
    );
    const current = currentResult.rows[0]?.status;
    if (!current) throw new Error("Agent goal not found.");

    const idempotent =
      (transition === "pause" && current === "paused") ||
      (transition === "resume" && current === "running") ||
      (transition === "cancel" && current === "canceled") ||
      (transition === "retry" && current === "running");
    if (idempotent) return this.get(userId, workspaceId, goalId);

    const allowed: Record<AgentGoalTransition, readonly AgentGoalStatus[]> = {
      pause: ["draft", "running", "waiting_approval", "waiting_desktop"],
      resume: ["paused", "waiting_desktop"],
      cancel: ["draft", "running", "waiting_approval", "waiting_desktop", "paused"],
      retry: ["failed", "canceled"],
    };
    if (!allowed[transition].includes(current)) {
      throw new AgentGoalTransitionError(`Agent goal cannot ${transition} from status ${current}.`);
    }

    const status: AgentGoalStatus = transition === "pause"
      ? "paused"
      : transition === "cancel"
        ? "canceled"
        : "running";
    const terminal = status === "canceled";
    const updated = await this.db.query<{ id: string }>(
      `update agent_goals
          set status=$4,
              error_message=case when $4 in ('running','canceled') then null else error_message end,
              updated_at=now(),
              completed_at=case when $5 then now() when $4='running' then null else completed_at end
        where id=$1 and created_by=$2 and workspace_id=$3 and status=$6
        returning id`,
      [goalId, userId, workspaceId, status, terminal, current],
    );
    if (!updated.rows[0]) {
      const latest = (await this.db.query<{ status: AgentGoalStatus }>(
        "select status from agent_goals where id=$1 and created_by=$2 and workspace_id=$3",
        [goalId, userId, workspaceId],
      )).rows[0]?.status;
      if (
        (transition === "pause" && latest === "paused") ||
        (transition === "resume" && latest === "running") ||
        (transition === "cancel" && latest === "canceled") ||
        (transition === "retry" && latest === "running")
      ) return this.get(userId, workspaceId, goalId);
      throw new AgentGoalTransitionError(`Agent goal changed before it could ${transition}.`);
    }
    if (status === "paused") {
      await this.db.query("update desktop_agent_tasks set status='paused',updated_at=now() where goal_id=$1 and status in ('queued','running','waiting_approval','waiting_desktop')", [goalId]);
    } else if (status === "canceled") {
      await this.db.query("update desktop_agent_tasks set status='canceled',completed_at=now(),updated_at=now() where goal_id=$1 and status in ('queued','running','waiting_approval','waiting_desktop','paused')", [goalId]);
      await this.db.query("update desktop_agent_approvals set status='expired' where task_id in (select id from desktop_agent_tasks where goal_id=$1) and status='pending'", [goalId]);
    } else if (status === "running") {
      await this.db.query("update desktop_agent_tasks set status='running',wait_reason=null,updated_at=now() where goal_id=$1 and status in ('paused','waiting_desktop')", [goalId]);
    }
    await this.db.query("insert into agent_goal_events(goal_id,event_type,detail) values($1,$2,$3)", [goalId, `goal.${transition}`, `目标已执行${transition}操作，当前状态为 ${status}`]);
    return this.get(userId, workspaceId, goalId);
  }

  async assertApproval(userId: string, workspaceId: string, goalId: string, approvalId: string) {
    const result = await this.db.query(
      `select a.id from desktop_agent_approvals a
         join desktop_agent_tasks t on t.id=a.task_id
        where a.id=$1 and t.goal_id=$2 and a.user_id=$3 and a.workspace_id=$4`,
      [approvalId, goalId, userId, workspaceId],
    );
    if (!result.rows[0]) throw new Error("Agent goal approval not found.");
  }

  private async assertContext(userId: string, workspaceId: string, input: AgentGoalCreateRequest) {
    if (input.canvasId) {
      const canvas = await this.db.query(
        `select c.id from canvases c join projects p on p.id=c.project_id join workspace_members wm on wm.workspace_id=p.workspace_id
          where c.id=$1 and p.workspace_id=$2 and wm.user_id=$3`,
        [input.canvasId, workspaceId, userId],
      );
      if (!canvas.rows[0]) throw new Error("Canvas is not available in this workspace.");
    }
    if (input.chatSessionId) {
      const session = await this.db.query(
        `select cs.id
           from chat_sessions cs
           join canvases c on c.id=cs.canvas_id
           join projects p on p.id=c.project_id
           join workspace_members wm on wm.workspace_id=p.workspace_id and wm.user_id=$3
          where cs.id=$1 and cs.created_by=$2 and p.workspace_id=$4`,
        [input.chatSessionId, userId, userId, workspaceId],
      );
      if (!session.rows[0]) throw new Error("Chat session is not available.");
    }
  }
}
