import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { agentGoalDocumentSchema } from "@helstera/shared";
import { ReadOnlyGoalPausedError } from "./agent-goal-interruption.js";

import type {
  AgentGoalPlan,
  AgentGoalOutput,
  AgentGoalStatus,
  DesktopAgentExecutionMode,
  DesktopAgentTaskRequest,
  DesktopCapability,
} from "@helstera/shared";

type GoalDispatcher = {
  createDesktopAgentTask(
    userId: string,
    workspaceId: string,
    input: DesktopAgentTaskRequest,
    chatSessionId?: string,
    goalId?: string,
  ): Promise<{ taskId: string }>;
};

export type BackgroundGoalInput = {
  taskId: string;
  goal: GoalRow;
  request: DesktopAgentTaskRequest;
};

export type BackgroundGoalExecutor = (
  input: BackgroundGoalInput,
) => Promise<Record<string, unknown>>;

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
  output_kind: "auto" | "canvas" | "document" | "image" | "video" | "bundle";
  execution_policy: "approval_required" | "suggest_only";
  capabilities: DesktopCapability[];
  next_attempt_at: string | Date | null;
};

type TaskRow = {
  id: string;
  status:
    | "queued"
    | "running"
    | "waiting_approval"
    | "waiting_desktop"
    | "paused"
    | "succeeded"
    | "failed"
    | "canceled";
  result: Record<string, unknown> | null;
  error_message: string | null;
};

const DEFAULT_CAPABILITIES: Record<
  DesktopAgentExecutionMode,
  DesktopCapability[]
> = {
  automatic: [
    "browser.read",
    "browser.navigate",
    "browser.scroll",
    "browser.capture",
  ],
  isolated_browser: [
    "browser.read",
    "browser.navigate",
    "browser.scroll",
    "browser.capture",
  ],
  connected_browser_tab: [
    "browser.read",
    "browser.navigate",
    "browser.scroll",
    "browser.capture",
  ],
  windows_ui: ["screen.read", "window.focus"],
  visual_ocr: ["screen.read", "window.focus"],
};

const activeTaskStatuses = new Set<TaskRow["status"]>([
  "queued",
  "running",
  "waiting_approval",
  "waiting_desktop",
  "paused",
]);

export const DESKTOP_RETRY_COOLDOWN_SECONDS = 10;

export function shouldRetryWaitingDesktop(
  nextAttemptAt: string | Date | null,
  now = Date.now(),
) {
  if (nextAttemptAt === null) return true;
  const retryTime = new Date(nextAttemptAt).getTime();
  if (!Number.isFinite(retryTime)) return false;
  return now >= retryTime;
}

export function extractGoalUrl(goal: string): string | undefined {
  const match = goal.match(/https?:\/\/[^\s<>"')]+/i)?.[0];
  if (!match) return undefined;
  try {
    const url = new URL(match);
    return url.username || url.password ? undefined : url.toString();
  } catch {
    return undefined;
  }
}

function desktopResultAssets(result: Record<string, unknown>) {
  const assets = Array.isArray(result.assets)
    ? result.assets.filter((asset): asset is Record<string, unknown> => Boolean(asset) && typeof asset === "object" && !Array.isArray(asset))
    : [];
  const ids = new Set(assets.map((asset) => asset.id).filter((id): id is string => typeof id === "string"));
  for (const [key, mediaType] of [["screenshotAsset", "image"], ["recordingAsset", "video"]] as const) {
    const value = result[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const asset = value as Record<string, unknown>;
    if (typeof asset.assetId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(asset.assetId) || ids.has(asset.assetId)) continue;
    ids.add(asset.assetId);
    assets.push({ ...asset, id: asset.assetId, mediaType });
  }
  return assets;
}

export function buildGoalTaskRequest(goal: GoalRow): DesktopAgentTaskRequest {
  const capabilities = goal.capabilities.length
    ? [...goal.capabilities]
    : [...DEFAULT_CAPABILITIES[goal.execution_mode]];
  const targetUrl = extractGoalUrl(goal.goal);
  const isBrowser = capabilities.includes("browser.read");
  const plannedActions = isBrowser
    ? [
        ...(targetUrl ? [{ kind: "navigate" as const, targetUrl }] : []),
        { kind: "read_page" as const },
        { kind: "capture_screen" as const },
      ]
    : [];

  return {
    goal: goal.goal,
    role: "operator",
    capabilities,
    executionMode: goal.execution_mode,
    plannedActions,
    maxDurationSeconds: 300,
    pageLimit: 3,
    ...(targetUrl ? { targetUrl } : {}),
  };
}

export class AgentGoalWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly db: Pool,
    private readonly dispatcher: GoalDispatcher,
    private readonly intervalMs = 1_000,
    private readonly backgroundExecutor?: BackgroundGoalExecutor,
  ) {}

  start() {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const { rows } = await this.db.query<GoalRow>(
        `select id,workspace_id,created_by,canvas_id,chat_session_id,goal,status,plan,execution_mode,output_kind,execution_policy,capabilities,next_attempt_at
           from agent_goals
          where coalesce(plan->>'version','1') <> '2' and (status = 'running'
             or (status='waiting_desktop'
                 and (next_attempt_at is null or next_attempt_at <= now()))
             or (status='waiting_approval' and (
               select t.status from desktop_agent_tasks t
                where t.goal_id=agent_goals.id order by t.created_at desc limit 1
              )='succeeded'))
          order by updated_at asc
          limit 20`,
      );
      for (const goal of rows) {
        const client = await this.db.connect();
        let locked = false;
        let releaseError: Error | undefined;
        try {
          const lock = await client.query<{ locked: boolean }>(
            "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
            [`agent-goal:${goal.id}`],
          );
          locked = lock.rows[0]?.locked === true;
          if (!locked) continue;
          // Recheck after locking: another worker or the user may have changed it.
          const current = await client.query<GoalRow>(
            "select * from agent_goals where id=$1 and status in ('running','waiting_desktop','waiting_approval') and execution_policy='approval_required'",
            [goal.id],
          );
          if (current.rows[0]) {
            await new GoalExecution(client, this.dispatcher, this.backgroundExecutor).process(current.rows[0]);
          }
        } finally {
          try {
            if (locked) await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [`agent-goal:${goal.id}`]);
          } catch (error) {
            releaseError = error instanceof Error ? error : new Error(String(error));
            throw error;
          } finally {
            client.release(releaseError);
          }
        }
      }
    } catch (error) {
      console.error("[agent-goal-worker] tick failed:", error);
    } finally {
      this.running = false;
    }
  }

}

class GoalExecution {
  constructor(
    private readonly db: Pick<Pool, "query">,
    private readonly dispatcher: GoalDispatcher,
    private readonly backgroundExecutor?: BackgroundGoalExecutor,
  ) {}

  async process(goal: GoalRow) {
    if (!["running", "waiting_desktop", "waiting_approval"].includes(goal.status) || goal.execution_policy !== "approval_required") return;
    const task = await this.latestTask(goal.id);
    if (goal.status === "waiting_approval" && task?.status !== "succeeded") return;
    const canRetryTerminalTask =
      task &&
      ["failed", "canceled"].includes(task.status) &&
      goal.status === "running";
    if (task && (!canRetryTerminalTask || task.status === "succeeded")) {
      await this.syncTask(goal, task);
      return;
    }

    const needsApproval = goal.plan.steps.some((step) => step.requiresApproval);
    if (needsApproval) {
      await this.waitForApproval(
        goal,
        "This goal contains a side-effect step. Submit the exact action from chat or the desktop task composer to request approval.",
      );
      return;
    }

    const claimed = await this.db.query<{
      id: string;
      status: AgentGoalStatus;
    }>(
      `update agent_goals
          set next_attempt_at=case
                when status='waiting_desktop' then now() + ($2 * interval '1 second')
                when $3::boolean then now() + ($2 * interval '1 second')
                else null
              end,
              updated_at=now()
        where id=$1 and (
          (status='waiting_desktop' and (next_attempt_at is null or next_attempt_at <= now()))
          or ($3::boolean and status='running' and (next_attempt_at is null or next_attempt_at <= now()))
        )
      returning id,status`,
      [goal.id, DESKTOP_RETRY_COOLDOWN_SECONDS, !task || Boolean(canRetryTerminalTask)],
    );
    if (!claimed.rows[0]) return;

    const request = buildGoalTaskRequest(goal);
    if (
      goal.execution_mode === "automatic" ||
      goal.execution_mode === "isolated_browser"
    ) {
      await this.runBackground(goal, request);
      return;
    }

    try {
      await this.dispatcher.createDesktopAgentTask(
        goal.created_by,
        goal.workspace_id,
        request,
        goal.chat_session_id ?? undefined,
        goal.id,
      );
      if (claimed.rows[0].status === "waiting_desktop")
        await this.setStatus(goal, "running");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not connected|未连接|桌面助手|connection/i.test(message)) {
        await this.waitForDesktop(
          goal,
          "Desktop connection is required for this goal. Reconnect the desktop app to continue.",
        );
        return;
      }
      await this.failGoal(goal, message);
    }
  }

  private async runBackground(goal: GoalRow, request: DesktopAgentTaskRequest) {
    if (!this.backgroundExecutor) {
      await this.failGoal(
        goal,
        "Background Agent execution is not configured for this server.",
      );
      return;
    }

    const taskId = randomUUID();
    await this.db.query(
      `insert into desktop_agent_tasks
        (id,workspace_id,created_by,connection_id,goal,role,capabilities,target_url,execution_mode,planned_actions,max_duration_seconds,chat_session_id,goal_id,status)
       values($1,$2,$3,null,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11,$12,'running')`,
      [
        taskId,
        goal.workspace_id,
        goal.created_by,
        goal.goal,
        request.role,
        JSON.stringify(request.capabilities),
        request.targetUrl ?? null,
        request.executionMode,
        JSON.stringify(request.plannedActions),
        request.maxDurationSeconds,
        goal.chat_session_id,
        goal.id,
      ],
    );
    await this.appendEvent(
      goal.id,
      "goal.task_started",
      "Background browser task started.",
      { taskId },
    );

    try {
      const result = await this.backgroundExecutor({ taskId, goal, request });
      const saved = await this.db.query<{ id: string }>(
        `update desktop_agent_tasks
            set status='succeeded',result=$2::jsonb,completed_at=now(),updated_at=now()
          where id=$1 and status='running' returning id`,
        [taskId, JSON.stringify(result)],
      );
      if (!saved.rows[0]) return;
      await this.db.query(
        "insert into desktop_agent_events(task_id,event_type,detail,payload) values($1,'completed',$2,$3::jsonb)",
        [taskId, "Background browser task completed.", JSON.stringify(result)],
      );
    } catch (error) {
      if (error instanceof ReadOnlyGoalPausedError) {
        // Only the read-only capture executor emits this: never replay paid or native actions here.
        const paused = await this.db.query<{ id: string }>(
          `update desktop_agent_tasks
              set status='canceled',wait_reason='paused_read_only_capture',error_message=$2,completed_at=now(),updated_at=now()
            where id=$1 and connection_id is null and status in ('running','paused') returning id`,
          [taskId, error.message],
        );
        if (paused.rows[0]) await this.appendEvent(goal.id, "goal.activity", error.message, { taskId, resumeBehavior: "restart_read_only_capture" });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failed = await this.db.query<{ id: string }>(
        `update desktop_agent_tasks
            set status='failed',error_message=$2,completed_at=now(),updated_at=now()
          where id=$1 and status='running' returning id`,
        [taskId, message.slice(0, 1_000)],
      );
      if (!failed.rows[0]) return;
      await this.db.query(
        "insert into desktop_agent_events(task_id,event_type,detail) values($1,'failed',$2)",
        [taskId, message.slice(0, 1_000)],
      );
    }

    const latest = await this.latestTask(goal.id);
    if (latest) await this.syncTask(goal, latest);
  }

  private async latestTask(goalId: string) {
    const { rows } = await this.db.query<TaskRow>(
      `select id,status,result,error_message
         from desktop_agent_tasks
        where goal_id=$1
        order by created_at desc
        limit 1`,
      [goalId],
    );
    return rows[0] ?? null;
  }

  private async syncTask(goal: GoalRow, task: TaskRow) {
    if (activeTaskStatuses.has(task.status)) {
      const nextStatus: AgentGoalStatus =
        task.status === "waiting_approval"
          ? "waiting_approval"
          : task.status === "waiting_desktop"
            ? "waiting_desktop"
            : "running";
      await this.setStatus(goal, nextStatus);
      return;
    }

    if (task.status === "succeeded") {
      const completedAt = new Date().toISOString();
      const assets = desktopResultAssets(task.result ?? {});
      const result = {
        ...(task.result ?? {}),
        ...(assets.length ? { assets } : {}),
        executionMode: goal.execution_mode,
        completedAt,
      };
      const plan = {
        ...goal.plan,
        steps: goal.plan.steps.map((step) => ({
          ...step,
          status: "succeeded" as const,
        })),
      };
      await this.db.query("begin");
      try {
        const updated = await this.db.query<{ id: string }>(
          `update agent_goals
            set status='completed',result=$2::jsonb,plan=$3::jsonb,error_message=null,completed_at=now(),updated_at=now()
          where id=$1 and status in ('running','waiting_desktop','waiting_approval')
        returning id`,
          [goal.id, JSON.stringify(result), JSON.stringify(plan)],
        );
        if (updated.rows[0]) {
          await this.persistOutputs(goal.id, result);
          await this.appendEvent(
            goal.id,
            "goal.completed",
            "Agent goal completed.",
            result,
          );
          await this.appendGoalChatMessage(goal, "completed", result);
          await this.learnFromGoal(goal);
        }
        await this.db.query("commit");
      } catch (error) {
        await this.db.query("rollback");
        throw error;
      }
      return;
    }

    const status: AgentGoalStatus =
      task.status === "canceled" ? "canceled" : "failed";
    await this.failGoal(
      goal,
      task.error_message ?? `Desktop task ${status}.`,
      status,
    );
  }

  private async waitForApproval(goal: GoalRow, detail: string) {
    await this.setStatus(goal, "waiting_approval", detail);
  }

  private async waitForDesktop(goal: GoalRow, detail: string) {
    const changed = await this.db.query<{ id: string }>(
      `update agent_goals
          set status='waiting_desktop',updated_at=now(),next_attempt_at=now() + ($2 * interval '1 second')
        where id=$1 and status='running'
      returning id`,
      [goal.id, DESKTOP_RETRY_COOLDOWN_SECONDS],
    );
    if (changed.rows[0])
      await this.appendEvent(goal.id, "goal.waiting_desktop", detail, {});
    else
      await this.db.query(
        `update agent_goals
          set next_attempt_at=now() + ($2 * interval '1 second'),updated_at=now()
        where id=$1 and status='waiting_desktop'`,
        [goal.id, DESKTOP_RETRY_COOLDOWN_SECONDS],
      );
  }

  private async failGoal(
    goal: GoalRow,
    detail: string,
    status: AgentGoalStatus = "failed",
  ) {
    const updated = await this.db.query<{ id: string }>(
      `update agent_goals set status=$2,error_message=$3,completed_at=now(),updated_at=now()
        where id=$1 and status in ('running','waiting_desktop','waiting_approval')
      returning id`,
      [goal.id, status, detail],
    );
    if (updated.rows[0])
      await this.appendEvent(goal.id, `goal.${status}`, detail, {
        error: detail,
      });
  }

  private async setStatus(
    goal: GoalRow,
    status: AgentGoalStatus,
    detail?: string,
  ) {
    const updated = await this.db.query<{ id: string }>(
      `update agent_goals set status=$2,next_attempt_at=null,updated_at=now()
        where id=$1 and status <> $2 and status in ('running','waiting_desktop','waiting_approval')
      returning id`,
      [goal.id, status],
    );
    if (updated.rows[0])
      await this.appendEvent(
        goal.id,
        `goal.${status}`,
        detail ?? `Goal status changed to ${status}.`,
        {},
      );
  }

  private async appendEvent(
    goalId: string,
    eventType: string,
    detail: string,
    payload: Record<string, unknown>,
  ) {
    await this.db.query(
      "insert into agent_goal_events(goal_id,event_type,detail,payload) values($1,$2,$3,$4::jsonb)",
      [goalId, eventType, detail, JSON.stringify(payload)],
    );
  }

  private async appendGoalChatMessage(
    goal: GoalRow,
    status: "completed" | "failed" | "canceled",
    result: Record<string, unknown>,
  ) {
    if (!goal.chat_session_id) return;
    const summary =
      typeof result.summary === "string"
        ? result.summary
        : "Agent goal finished.";
    const content =
      status === "completed"
        ? `Agent goal completed.\n\n${summary}`
        : `Agent goal ${status}.\n\n${summary}`;
    await this.db.query(
      `insert into chat_messages(session_id,role,content,client_message_id)
       select cs.id,'assistant',$2,$3 from chat_sessions cs
        where cs.id=$1 and cs.created_by=$4
       on conflict (session_id,client_message_id) do nothing`,
      [
        goal.chat_session_id,
        content.slice(0, 12_000),
        `agent-goal:${goal.id}:${status}`,
        goal.created_by,
      ],
    );
    await this.db.query(
      "update chat_sessions set updated_at=now() where id=$1",
      [goal.chat_session_id],
    );
  }

  private async learnFromGoal(goal: GoalRow) {
    const memory = await this.db.query<{ id: string }>(
      `insert into agent_memories
        (id,workspace_id,user_id,kind,key,value,source,confidence)
       values($1,$2,$3,'workflow','preferred_execution_mode',$4,$5,0.65)
       on conflict (workspace_id,user_id,kind,key)
       do update set value=excluded.value,source=excluded.source,confidence=greatest(agent_memories.confidence, excluded.confidence),last_used_at=now(),updated_at=now()
       where agent_memories.enabled=true
       returning id`,
      [randomUUID(), goal.workspace_id, goal.created_by, goal.execution_mode, `goal:${goal.id}`],
    );
    if (!memory.rows[0]) return;
    await this.db.query(
      "insert into agent_memory_events(memory_id,event_type,source_type,source_id,detail) values($1,'learned','agent_goal',$2,$3)",
      [memory.rows[0].id, goal.id, `Learned the execution mode used for ${goal.output_kind} output.`],
    );
    if (goal.output_kind === "auto") return;
    await this.db.query(
      `insert into agent_suggestions
        (id,workspace_id,user_id,canvas_id,chat_session_id,kind,title,detail,goal,source_memory_ids,expires_at,execution_mode,output_kind)
       values($1,$2,$3,$4,$5,'workflow',$6,$7,$8,$9::jsonb,now() + interval '30 days',$10,$11)`,
      [
        randomUUID(),
        goal.workspace_id,
        goal.created_by,
        goal.canvas_id,
        goal.chat_session_id,
        `Reuse the ${goal.output_kind} workflow`,
        `The last goal used ${goal.execution_mode}. I can prepare the same type of result again, but will wait for your confirmation before running it.`,
        `Create another ${goal.output_kind} result using the same execution mode.`,
        JSON.stringify([memory.rows[0].id]),
        goal.execution_mode,
        goal.output_kind,
      ],
    );
  }

  private async persistOutputs(goalId: string, result: Record<string, unknown>) {
    const outputs: Array<{
      kind: string;
      localPath: string | null;
      cloudAssetId: string | null;
      status: AgentGoalOutput["status"];
      metadata: Record<string, unknown>;
    }> = [];
    const localPaths = Array.isArray(result.localPaths)
      ? result.localPaths.filter((path): path is string => typeof path === "string" && path.length > 0)
      : [];
    if (Array.isArray(result.documents)) {
      for (const entry of result.documents) {
        const document = agentGoalDocumentSchema.parse(entry);
        outputs.push({
          kind: "document", localPath: null, cloudAssetId: null, status: "pending",
          metadata: {
            documentId: document.id, title: document.title, fileName: document.fileName,
            mimeType: document.mimeType, sourceUrls: document.sourceUrls, saveState: "pending_local",
          },
        });
      }
    }
    for (const localPath of localPaths) {
      outputs.push({ kind: "local_file", localPath, cloudAssetId: null, status: "pending", metadata: { saveState: "pending_verification", reason: "本地路径尚无文件摘要与保存回执" } });
    }
    const assets = Array.isArray(result.assets)
      ? result.assets.filter((asset): asset is Record<string, unknown> => Boolean(asset) && typeof asset === "object" && !Array.isArray(asset))
      : [];
    for (const asset of assets) {
      const assetId = typeof asset.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(asset.id)
        ? asset.id
        : null;
      const localPath = typeof asset.localPath === "string" ? asset.localPath : null;
      outputs.push({
        kind: typeof asset.mediaType === "string" ? asset.mediaType : "asset",
        localPath,
        cloudAssetId: assetId,
        status: assetId ? "saved_cloud" : "pending",
        metadata: { ...asset, ...(localPath ? { localSaveState: "pending_verification" } : {}) },
      });
    }
    for (const output of outputs) {
      await this.db.query(
        `insert into agent_goal_outputs
          (id,goal_id,kind,local_path,cloud_asset_id,status,metadata)
         values($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [randomUUID(), goalId, output.kind, output.localPath, output.cloudAssetId, output.status, JSON.stringify(output.metadata)],
      );
    }
  }
}
