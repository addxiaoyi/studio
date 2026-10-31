import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import {
  agentGoalCreateRequestSchema,
  type AgentGoal,
  type AgentGoalCreateRequest,
  type AgentGoalPlan,
  type AgentGoalPlanStep,
  type AgentGoalOutput,
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
  output_kind: AgentGoal["outputKind"];
  source: AgentGoal["source"];
  execution_policy: AgentGoal["executionPolicy"];
  parent_goal_id: string | null;
  connection_ids: string[];
  memory_context_ids: string[];
  suggestion_state: AgentGoal["suggestionState"];
  capabilities: string[];
  result: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
  confirmed_at: string | Date | null;
};

type OutputRow = {
  id: string;
  goal_id: string;
  kind: string;
  local_path: string | null;
  cloud_asset_id: string | null;
  status: AgentGoalOutput["status"];
  metadata: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
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

export function buildAgentGoalPlan(
  goal: string,
  executionMode: DesktopAgentExecutionMode,
  outputKind: AgentGoal["outputKind"] = "auto",
): AgentGoalPlan {
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
  constructor(private readonly db: Pick<Pool, "query">) {}

  async create(userId: string, workspaceId: string, rawInput: AgentGoalCreateRequest): Promise<AgentGoal> {
    const input = agentGoalCreateRequestSchema.parse(rawInput);
    await this.assertContext(userId, workspaceId, input);
    const plan = buildAgentGoalPlan(input.goal, input.executionMode, input.outputKind);
    const goalId = randomUUID();
    const inserted = await this.db.query<{ id: string }>(
      `insert into agent_goals
        (id,workspace_id,created_by,canvas_id,chat_session_id,goal,status,plan,execution_mode,output_kind,source,execution_policy,parent_goal_id,connection_ids,memory_context_ids,capabilities,attachments,idempotency_key,suggestion_state)
       values($1,$2,$3,$4,$5,$6,'draft',$7::jsonb,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18)
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
        input.outputKind,
        input.source,
        input.executionPolicy,
        input.parentGoalId ?? null,
        JSON.stringify(input.connectionIds),
        JSON.stringify(input.memoryContextIds),
        JSON.stringify(input.capabilities),
        JSON.stringify(input.attachments),
        input.idempotencyKey,
        input.source === "suggestion" ? "accepted" : "none",
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
      `select id,workspace_id,created_by,canvas_id,chat_session_id,goal,status,plan,execution_mode,output_kind,source,execution_policy,parent_goal_id,connection_ids,memory_context_ids,suggestion_state,capabilities,result,error_message,created_at,updated_at,completed_at,confirmed_at
         from agent_goals where id=$1 and created_by=$2 and workspace_id=$3`,
      [goalId, userId, workspaceId],
    );
    const row = goal.rows[0];
    if (!row) throw new Error("Agent goal not found.");
    // The service can share a transaction client; keep queries sequential on that connection.
    const tasks = await this.db.query(
        `select t.id as "taskId",t.goal_id as "goalId",t.parent_task_id as "parentTaskId",t.goal,t.role,t.execution_mode as "executionMode",t.capabilities,t.status,t.checkpoint,t.wait_reason as "waitReason",t.result,t.error_message as error,t.created_at as "createdAt",t.updated_at as "updatedAt",
           coalesce(t.status in ('waiting_desktop','paused','failed','canceled') and (c.disconnected_at is not null or c.revoked_at is not null)
             and t.checkpoint->'action'->>'state' in ('dispatched','uncertain'),false) as "reviewAvailable"
           from desktop_agent_tasks t left join website_capture_connections c on c.id=t.connection_id where t.goal_id=$1 order by t.created_at asc`,
        [goalId],
      );
    const activities = await this.db.query(
        `select id,task_id as "taskId",event_type as "eventType",detail,payload,created_at as "createdAt"
           from agent_goal_events where goal_id=$1 order by created_at desc limit 100`,
        [goalId],
      );
    const approvals = await this.db.query(
        `select a.id as "approvalId",a.task_id as "taskId",a.action,a.status,a.expires_at as "expiresAt"
           from desktop_agent_approvals a join desktop_agent_tasks t on t.id=a.task_id
          where t.goal_id=$1 order by a.created_at desc limit 50`,
        [goalId],
      );
    const outputs = await this.db.query<OutputRow>(
        `select id,goal_id,kind,local_path,cloud_asset_id,status,metadata,created_at,updated_at
           from agent_goal_outputs where goal_id=$1 order by created_at asc`,
        [goalId],
      );
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
      outputKind: row.output_kind,
      source: row.source,
      executionPolicy: row.execution_policy,
      ...(row.parent_goal_id ? { parentGoalId: row.parent_goal_id } : {}),
      connectionIds: row.connection_ids,
      memoryContextIds: row.memory_context_ids,
      suggestionState: row.suggestion_state,
      capabilities: row.capabilities as AgentGoal["capabilities"],
      tasks: tasks.rows.map((task) => ({
        ...task,
        outputKind: row.output_kind,
        source: row.source,
        executionPolicy: row.execution_policy,
        parentGoalId: row.parent_goal_id,
        connectionIds: row.connection_ids,
        memoryContextIds: row.memory_context_ids,
        suggestionState: row.suggestion_state,
        createdAt: iso(task.createdAt),
        updatedAt: iso(task.updatedAt),
      })),
      activities: activities.rows.map((activity) => ({
        ...activity,
        taskId: activity.taskId ?? undefined,
        createdAt: iso(activity.createdAt),
      })),
      approvals: approvals.rows.map((approval) => ({
        ...approval,
        expiresAt: iso(approval.expiresAt),
      })),
      outputs: outputs.rows.map((output) => ({
        id: output.id,
        goalId: output.goal_id,
        kind: output.kind,
        ...(output.local_path ? { localPath: output.local_path } : {}),
        ...(output.cloud_asset_id ? { cloudAssetId: output.cloud_asset_id } : {}),
        status: output.status,
        metadata: output.metadata ?? {},
        createdAt: iso(output.created_at),
        updatedAt: iso(output.updated_at),
      })),
      result: row.result,
      error: row.error_message,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      completedAt: row.completed_at ? iso(row.completed_at) : null,
    };
  }

  async confirm(userId: string, workspaceId: string, goalId: string) {
    const updated = await this.db.query<{ id: string }>(
      `with confirmed as (update agent_goals
          set status='running', confirmed_at=coalesce(confirmed_at, now()), updated_at=now(), error_message=null
        where id=$1 and created_by=$2 and workspace_id=$3 and status='draft' and execution_policy='approval_required'
        returning id)
       insert into agent_goal_events(goal_id,event_type,detail)
       select id,'goal.confirmed','Agent goal confirmed by the user.' from confirmed
       returning goal_id as id`,
      [goalId, userId, workspaceId],
    );
    if (!updated.rows[0]) {
      const current = await this.db.query<{ status: AgentGoalStatus }>(
        "select status from agent_goals where id=$1 and created_by=$2 and workspace_id=$3",
        [goalId, userId, workspaceId],
      );
      if (current.rows[0]?.status === "running") return this.get(userId, workspaceId, goalId);
      if (!current.rows[0]) throw new Error("Agent goal not found.");
      throw new AgentGoalTransitionError(`Agent goal cannot be confirmed from status ${current.rows[0].status}.`);
    }
    return this.get(userId, workspaceId, goalId);
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
      pause: ["running", "waiting_approval", "waiting_desktop"],
      resume: ["paused", "waiting_desktop"],
      cancel: ["draft", "running", "waiting_approval", "waiting_desktop", "paused"],
      retry: ["failed", "canceled"],
    };
    if (!allowed[transition].includes(current)) {
      throw new AgentGoalTransitionError(`Agent goal cannot ${transition} from status ${current}.`);
    }

    if (transition === "resume") {
      const unresolved = await this.db.query(
        `select 1 from desktop_agent_tasks where goal_id=$1 and status in ('paused','waiting_desktop')
          and checkpoint->'action'->>'state' in ('dispatched','uncertain') limit 1`,
        [goalId],
      );
      if (unresolved.rows.length) throw new AgentGoalTransitionError("The last action has an unknown outcome. Disconnect the desktop and review the action before continuing.");
    }

    if (transition === "retry") {
      const unsafe = await this.db.query(
        `select 1 from desktop_agent_tasks t where t.goal_id=$1 and t.execution_mode in ('windows_ui','visual_ocr')
          and (t.checkpoint ? 'action' or exists (select 1 from desktop_agent_approvals a where a.task_id=t.id and a.status in ('approved','executed'))) limit 1`,
        [goalId],
      );
      if (unsafe.rows.length) throw new AgentGoalTransitionError("This native task has dispatched actions. Review its history and create a new goal; automatic replay is not safe.");
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
              next_attempt_at=case when $4='running' then null else next_attempt_at end,
              updated_at=now(),
              completed_at=case when $5 then now() when $4='running' then null else completed_at end
        where id=$1 and created_by=$2 and workspace_id=$3 and status=$6
          and ($4 <> 'running' or (execution_policy='approval_required' and
            (confirmed_at is not null or exists (select 1 from desktop_agent_tasks where goal_id=$1))))
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

  async reviewInterruptedAction(userId: string, workspaceId: string, goalId: string, approvalId: string, outcome: "observed_completed" | "observed_not_completed") {
    const reviewed = await this.db.query<{ task_id: string }>(
      `with eligible as (
         select a.id,a.task_id from desktop_agent_approvals a
         join desktop_agent_tasks t on t.id=a.task_id
         join website_capture_connections c on c.id=t.connection_id
         where a.id=$1 and t.goal_id=$2 and a.user_id=$3 and a.workspace_id=$4
           and a.status in ('approved','executed') and t.status in ('waiting_desktop','paused','failed','canceled')
           and (c.disconnected_at is not null or c.revoked_at is not null)
           and t.checkpoint->'action'->>'approvalId'=a.id::text
           and t.checkpoint->'action'->>'state' in ('dispatched','uncertain')
         for update of t
       ), recorded as (
         update desktop_agent_tasks t set checkpoint=jsonb_set(t.checkpoint,'{action,state}',to_jsonb($5::text)),updated_at=now()
         from eligible e where t.id=e.task_id returning t.id
       ), logged as (
         insert into desktop_agent_events(task_id,event_type,detail,payload)
         select e.task_id,'action_manually_reviewed','User recorded an observation; the action was not replayed.',jsonb_build_object('approvalId',e.id,'outcome',$5::text)
         from eligible e join recorded r on r.id=e.task_id returning task_id
       ) select task_id from logged`,
      [approvalId, goalId, userId, workspaceId, outcome],
    );
    if (!reviewed.rows[0]) throw new AgentGoalTransitionError("No disconnected action is available for review, or it was already reviewed.");
    return { taskId: reviewed.rows[0].task_id, approvalId, outcome, replayed: false as const };
  }

  private async assertContext(userId: string, workspaceId: string, input: AgentGoalCreateRequest) {
    if (input.parentGoalId) {
      const parent = await this.db.query(
        "select id from agent_goals where id=$1 and workspace_id=$2 and created_by=$3",
        [input.parentGoalId, workspaceId, userId],
      );
      if (!parent.rows[0]) throw new Error("Parent goal is not available in this workspace.");
    }
    if (input.memoryContextIds?.length) {
      const ids = [...new Set(input.memoryContextIds)];
      const memories = await this.db.query(
        `select id from agent_memories where id=any($1::uuid[]) and workspace_id=$2 and user_id=$3
           and enabled=true and (expires_at is null or expires_at > now())`,
        [ids, workspaceId, userId],
      );
      if (memories.rows.length !== ids.length) throw new Error("Selected memories are unavailable or disabled.");
    }
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
