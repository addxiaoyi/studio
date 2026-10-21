import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { WebSocket } from "ws";

import { desktopAgentEventSchema, isDesktopActionAuthorized, type DesktopAgentAction, type DesktopAgentTaskRequest, type DesktopCapability, type WebsiteCaptureAssistantConnection, type WebsiteCapturePairing, type WebsiteCapturePage } from "@helstera/shared";
import { hashToken } from "../../local-db/auth.js";
import type { StorageProvider } from "../../storage/storage-provider.js";
import {
  buildWebsiteIntroduction,
  persistCaptureAsset,
  type CaptureTask,
} from "./isolated-browser.js";
import { classifyWebsiteAction, type WebsiteActionRequest } from "./action-policy.js";
import { decodeJpegPayload } from "./capture-payload.js";

const DISCLOSURE = "连接授权会持续到你断开或撤销。目标站点及按选择跟随的外链页面内容、截图和录屏会发送给当前聊天模型处理，并保存为工作区素材；Cookie、密码、OTP 和浏览器本地存储不会发送给 Helstera。网页内容始终是不可信输入。";
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const MAX_RECORDING_BYTES = 40 * 1024 * 1024;

type HubOptions = {
  db: Pool;
  storage: StorageProvider;
  webOrigin: string;
  storageRoot: string;
};

type LocalTask = CaptureTask & {
  mode: "local";
  status: string;
  assistant_connection_id: string;
  follow_external: boolean;
};

type LiveConnection = {
  id: string;
  userId: string;
  ws: WebSocket;
  sessionToken: string;
  browser: "chrome" | "edge" | "unknown";
  platform: "windows" | "macos" | "linux" | "unknown";
  paused: boolean;
};

export class WebsiteAssistantHub {
  private readonly connections = new Map<string, LiveConnection>();
  private readonly pages = new Map<string, WebsiteCapturePage[]>();
  private readonly taskTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly desktopTaskTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: HubOptions) {
    void this.options.db.query("update website_capture_connections set disconnected_at=coalesce(disconnected_at, now()) where revoked_at is null and disconnected_at is null").catch(() => undefined);
  }

  async createPairing(userId: string, workspaceId: string): Promise<WebsiteCapturePairing> {
    const code = randomBytes(18).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const result = await this.options.db.query<{ id: string }>(
      `insert into website_capture_pairings(workspace_id, created_by, code_hash, expires_at)
       values($1,$2,$3,$4) returning id`,
      [workspaceId, userId, hashToken(code), expiresAt],
    );
    const pairingId = result.rows[0]?.id;
    if (!pairingId) throw new Error("Unable to create local assistant pairing.");
    return {
      pairingId,
      code,
      expiresAt: expiresAt.toISOString(),
      wssUrl: this.wssUrl(),
      disclosure: DISCLOSURE,
    };
  }

  async getConnection(userId: string, workspaceId: string): Promise<WebsiteCaptureAssistantConnection | null> {
    const { rows } = await this.options.db.query<{
      id: string;
      browser: WebsiteCaptureAssistantConnection["browser"];
      platform: WebsiteCaptureAssistantConnection["platform"];
      paused: boolean;
      connected_at: string | Date;
      last_seen_at: string | Date;
      revoked_at: string | Date | null;
      disconnected_at: string | Date | null;
    }>(
      `select id,browser,platform,paused,connected_at,last_seen_at,revoked_at,disconnected_at
         from website_capture_connections
        where user_id=$1 and workspace_id=$2
        order by connected_at desc limit 1`,
      [userId, workspaceId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      status: row.revoked_at ? "revoked" : row.disconnected_at || !this.connections.has(row.id) ? "disconnected" : row.paused ? "paused" : "connected",
      browser: row.browser,
      platform: row.platform,
      connectedAt: new Date(row.connected_at).toISOString(),
      lastSeenAt: new Date(row.last_seen_at).toISOString(),
      paused: row.paused,
    };
  }

  async revoke(userId: string, workspaceId: string): Promise<void> {
    const result = await this.options.db.query<{ id: string }>(
      `update website_capture_connections set revoked_at=now(), disconnected_at=coalesce(disconnected_at, now())
        where user_id=$1 and workspace_id=$2 and revoked_at is null returning id`,
      [userId, workspaceId],
    );
    await this.options.db.query("update website_capture_pairings set revoked_at=now() where created_by=$1 and workspace_id=$2 and revoked_at is null", [userId, workspaceId]);
    for (const row of result.rows) {
      const live = this.connections.get(row.id);
      live?.ws.close(4004, "Revoked");
      this.connections.delete(row.id);
    }
  }

  async setUserPaused(userId: string, workspaceId: string, paused: boolean): Promise<void> {
    const result = await this.options.db.query<{ id: string }>(
      `update website_capture_connections set paused=$3,last_seen_at=now()
        where user_id=$1 and workspace_id=$2 and revoked_at is null returning id`,
      [userId, workspaceId, paused],
    );
    for (const row of result.rows) {
      const live = this.connections.get(row.id);
      if (live) {
        live.paused = paused;
        this.send(live, { type: paused ? "assistant.pause" : "assistant.resume" });
      }
    }
  }

  async startLocalTask(taskId: string, userId: string): Promise<void> {
    const { rows } = await this.options.db.query<LocalTask>(
      `select id,workspace_id,created_by,start_url,page_limit,record_video,status,assistant_connection_id,follow_external
         from website_capture_tasks where id=$1 and created_by=$2 and mode='local'`,
      [taskId, userId],
    );
    const task = rows[0];
    if (!task) throw new Error("Local website capture task not found.");
    const live = this.connections.get(task.assistant_connection_id);
    if (!live || live.ws.readyState !== 1 || live.paused) throw new Error("Local browser assistant is not connected.");
    this.pages.delete(taskId);
    await this.options.db.query("update website_capture_actions set status='expired' where task_id=$1 and status='pending'", [taskId]);
    const claimed = await this.options.db.query<{ id: string }>(
      "update website_capture_tasks set status='running', stage='connecting', progress=2, updated_at=now() where id=$1 and status='queued' returning id",
      [taskId],
    );
    if (!claimed.rows[0]) return;
    await this.event(taskId, "connecting", "正在连接已授权的本地浏览器标签页");
    this.clearTaskTimer(taskId);
    this.taskTimers.set(taskId, setTimeout(() => {
      void this.failTask(live, taskId, "本地浏览任务超过 15 分钟上限。");
    }, 15 * 60 * 1000));
    this.send(live, {
      type: "website_capture.start",
      taskId,
      startUrl: task.start_url,
      pageLimit: task.page_limit,
      recordVideo: task.record_video,
      followExternal: task.follow_external,
      disclosure: DISCLOSURE,
    });
  }

  async createDesktopAgentTask(userId: string, workspaceId: string, input: DesktopAgentTaskRequest) {
    const { rows: connections } = await this.options.db.query<{ id: string }>(
      `select id from website_capture_connections
        where user_id=$1 and workspace_id=$2 and revoked_at is null and disconnected_at is null and paused=false
        order by connected_at desc limit 1`,
      [userId, workspaceId],
    );
    const connectionId = connections[0]?.id;
    const live = connectionId ? this.connections.get(connectionId) : undefined;
    if (!connectionId || !live || live.ws.readyState !== 1) throw new Error("本地桌面助手未连接。");
    const taskId = randomUUID();
    const task = { ...input, taskId, createdAt: new Date().toISOString() };
    await this.options.db.query(
      `insert into desktop_agent_tasks(id,workspace_id,created_by,connection_id,goal,role,capabilities,target_url)
       values($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [taskId, workspaceId, userId, connectionId, input.goal, input.role, JSON.stringify(input.capabilities), input.targetUrl ?? null],
    );
    await this.options.db.query("update desktop_agent_tasks set status='running',updated_at=now() where id=$1", [taskId]);
    await this.options.db.query("insert into desktop_agent_events(task_id,event_type,detail) values($1,'started',$2)", [taskId, "桌面协作任务已发送"]);
    this.desktopTaskTimers.set(taskId, setTimeout(() => {
      this.send(live, { type: "desktop_agent.stop", taskId, reason: "桌面协作任务超过时限。" });
      void this.failDesktopTask(taskId, "桌面协作任务超过时限。");
    }, input.maxDurationSeconds * 1000));
    this.send(live, { type: "desktop_agent.task", task });
    return task;
  }

  async listDesktopAgentTasks(userId: string, workspaceId: string) {
    const { rows } = await this.options.db.query<{
      id: string;
      goal: string;
      role: string;
      capabilities: string[];
      target_url: string | null;
      status: string;
      result: Record<string, unknown> | null;
      error_message: string | null;
      created_at: string | Date;
      updated_at: string | Date;
      completed_at: string | Date | null;
      events: Array<{ eventType: string; detail: string | null; createdAt: string; approvalId?: string; action?: DesktopAgentAction; result?: Record<string, unknown> }>;
      pending_approvals: Array<{ approvalId: string; action: DesktopAgentAction; expiresAt: string }>;
    }>(
      `select t.id,t.goal,t.role,t.capabilities,t.target_url,t.status,t.result,t.error_message,t.created_at,t.updated_at,t.completed_at,
              coalesce((
                select json_agg(json_build_object(
                  'eventType',event_type,
                  'detail',detail,
                  'createdAt',created_at,
                  'approvalId',payload->>'approvalId',
                  'action',payload->'action',
                  'result',payload->'result'
                ) order by created_at desc)
                  from (select event_type,detail,payload,created_at from desktop_agent_events e where e.task_id=t.id order by created_at desc limit 6) recent
              ),'[]'::json) as events,
              coalesce((
                select json_agg(json_build_object('approvalId',a.id,'action',a.action,'expiresAt',a.expires_at) order by a.created_at desc)
                  from desktop_agent_approvals a where a.task_id=t.id and a.status='pending' and a.expires_at>now()
              ),'[]'::json) as pending_approvals
         from desktop_agent_tasks t where t.created_by=$1 and t.workspace_id=$2 order by t.created_at desc limit 30`,
      [userId, workspaceId],
    );
    return rows.map((row) => ({
      taskId: row.id,
      goal: row.goal,
      role: row.role,
      capabilities: row.capabilities,
      ...(row.target_url ? { targetUrl: row.target_url } : {}),
      status: row.status,
      result: row.result,
      error: row.error_message,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      ...(row.completed_at ? { completedAt: new Date(row.completed_at).toISOString() } : {}),
      events: row.events,
      pendingApprovals: row.pending_approvals,
    }));
  }

  async cancelDesktopAgentTask(userId: string, workspaceId: string, taskId: string) {
    const { rows } = await this.options.db.query<{ id: string; connection_id: string }>(
      `update desktop_agent_tasks set status='canceled',error_message=null,updated_at=now(),completed_at=now()
        where id=$1 and created_by=$2 and workspace_id=$3 and status in ('queued','running')
        returning id,connection_id`,
      [taskId, userId, workspaceId],
    );
    const row = rows[0];
    if (!row) throw new Error("桌面任务不存在或已经结束。");
    const live = this.connections.get(row.connection_id);
    if (live) this.send(live, { type: "desktop_agent.stop", taskId, reason: "用户取消了任务。" });
    this.clearDesktopTaskTimer(taskId);
    await this.options.db.query("update desktop_agent_approvals set status='expired' where task_id=$1 and status='pending'", [taskId]);
    await this.options.db.query("insert into desktop_agent_events(task_id,event_type,detail) values($1,'canceled',$2)", [taskId, "用户取消了任务"]);
    return { taskId, status: "canceled" as const };
  }

  async listPendingDesktopApprovals(userId: string, workspaceId: string, taskId: string) {
    const { rows } = await this.options.db.query<{ id: string; action: DesktopAgentAction; expires_at: string | Date }>(
      `select a.id,a.action,a.expires_at from desktop_agent_approvals a
        join desktop_agent_tasks t on t.id=a.task_id
       where a.task_id=$1 and a.user_id=$2 and a.workspace_id=$3 and a.status='pending' and a.expires_at>now()
       order by a.created_at desc`,
      [taskId, userId, workspaceId],
    );
    return rows.map((row) => ({ approvalId: row.id, action: row.action, expiresAt: new Date(row.expires_at).toISOString() }));
  }

  async approveDesktopAction(userId: string, workspaceId: string, approvalId: string) {
    const token = randomBytes(32).toString("base64url");
    const { rows } = await this.options.db.query<{ task_id: string; connection_id: string; action: DesktopAgentAction }>(
      `update desktop_agent_approvals set status='approved',approved_at=now(),approval_token_hash=$4
        where id=$1 and user_id=$2 and workspace_id=$3 and status='pending' and expires_at>now()
        returning task_id,connection_id,action`,
      [approvalId, userId, workspaceId, hashToken(token)],
    );
    const approval = rows[0];
    if (!approval) throw new Error("桌面动作审批已过期或不存在。");
    const live = this.connections.get(approval.connection_id);
    if (!live || live.ws.readyState !== 1 || live.paused) {
      await this.options.db.query("update desktop_agent_approvals set status='pending',approved_at=null,approval_token_hash=null where id=$1 and status='approved'", [approvalId]);
      throw new Error("桌面助手未连接或已暂停。");
    }
    this.send(live, { type: "desktop_agent.action", action: { ...approval.action, approvalId, approvalToken: token } });
    await this.options.db.query("insert into desktop_agent_events(task_id,event_type,detail,payload) values($1,'action_approved',$2,$3::jsonb)", [approval.task_id, "用户批准了桌面动作", JSON.stringify({ approvalId, action: { ...approval.action, approvalToken: undefined } })]);
    return { approvalId, status: "approved" as const };
  }

  async rejectDesktopAction(userId: string, workspaceId: string, approvalId: string) {
    const { rows } = await this.options.db.query<{ task_id: string; connection_id: string }>(
      `update desktop_agent_approvals set status='rejected',rejected_at=now()
        where id=$1 and user_id=$2 and workspace_id=$3 and status='pending'
        returning task_id,connection_id`,
      [approvalId, userId, workspaceId],
    );
    const approval = rows[0];
    if (!approval) throw new Error("桌面动作审批已过期或不存在。");
    const live = this.connections.get(approval.connection_id);
    if (live) this.send(live, { type: "desktop_agent.action_denied", approvalId, taskId: approval.task_id, reason: "用户拒绝了该动作。" });
    await this.options.db.query("insert into desktop_agent_events(task_id,event_type,detail,payload) values($1,'action_rejected',$2,$3::jsonb)", [approval.task_id, "用户拒绝了桌面动作", JSON.stringify({ approvalId })]);
    return { approvalId, status: "rejected" as const };
  }

  async revokeTask(taskId: string): Promise<void> {
    const { rows } = await this.options.db.query<{ assistant_connection_id: string | null }>(
      "select assistant_connection_id from website_capture_tasks where id=$1",
      [taskId],
    );
    const connectionId = rows[0]?.assistant_connection_id;
    const live = connectionId ? this.connections.get(connectionId) : undefined;
    if (live) this.send(live, { type: "website_capture.stop", taskId });
  }

  async listPendingActions(userId: string, taskId: string) {
    const { rows } = await this.options.db.query<{ id: string; action: WebsiteActionRequest; reason: string; expires_at: string }>(
      `select id,action,reason,expires_at from website_capture_actions
        where task_id=$1 and user_id=$2 and status='pending' and expires_at > now()
        order by created_at desc`,
      [taskId, userId],
    );
    return rows.map((row) => ({ actionId: row.id, action: row.action, reason: row.reason, expiresAt: new Date(row.expires_at).toISOString() }));
  }

  async approveAction(userId: string, actionId: string) {
    const token = randomBytes(32).toString("base64url");
    const { rows } = await this.options.db.query<{ task_id: string; connection_id: string; action: WebsiteActionRequest }>(
      `update website_capture_actions set status='approved', approved_at=now(), approval_token_hash=$3
        where id=$1 and user_id=$2 and status='pending' and expires_at > now()
        returning task_id,connection_id,action`,
      [actionId, userId, hashToken(token)],
    );
    const row = rows[0];
    if (!row) throw new Error("动作确认已过期或不存在。");
    const live = this.connections.get(row.connection_id);
    if (!live || live.ws.readyState !== 1) {
      await this.options.db.query("update website_capture_actions set status='pending', approved_at=null, approval_token_hash=null where id=$1 and status='approved'", [actionId]);
      throw new Error("本地浏览器助手已断开。");
    }
    this.send(live, { type: "website_capture.action_execute", actionId, taskId: row.task_id, action: row.action, approvalToken: token });
    await this.event(row.task_id, "action_approved", `用户已确认动作：${row.action.kind}`);
    return { actionId, status: "approved" as const };
  }

  async rejectAction(userId: string, actionId: string) {
    const { rows } = await this.options.db.query<{ task_id: string; connection_id: string }>(
      "update website_capture_actions set status='rejected', rejected_at=now() where id=$1 and user_id=$2 and status='pending' returning task_id,connection_id",
      [actionId, userId],
    );
    const row = rows[0];
    if (!row) throw new Error("动作确认已过期或不存在。");
    const live = this.connections.get(row.connection_id);
    if (live) this.send(live, { type: "website_capture.action_denied", actionId, taskId: row.task_id, reason: "用户拒绝了动作。" });
    await this.event(row.task_id, "action_rejected", "用户拒绝了网页动作");
    return { actionId, status: "rejected" as const };
  }

  private async consumeApprovedAction(live: LiveConnection, message: any) {
    const actionId = String(message.actionId ?? "");
    const approvalToken = String(message.approvalToken ?? "");
    if (!actionId) {
      this.send(live, { type: "website_capture.action_denied", actionId, taskId: message.taskId, reason: "动作缺少一次性确认令牌。" });
      return;
    }
    if (!approvalToken) {
      const decision = classifyWebsiteAction(message.action as WebsiteActionRequest);
      if (decision.state === "allow") {
        const task = await this.loadLocalTask(live, String(message.taskId ?? ""));
        if (task) await this.event(task.id, "action_executed", JSON.stringify({ actionId, ok: Boolean(message.ok), message: String(message.message ?? "").slice(0, 500) }));
        return;
      }
      this.send(live, { type: "website_capture.action_denied", actionId, taskId: message.taskId, reason: "副作用动作必须携带一次性确认令牌。" });
      return;
    }
    const result = await this.options.db.query<{ task_id: string }>(
      `update website_capture_actions
          set status='executed', consumed_at=now()
        where id=$1 and connection_id=$2 and status='approved'
          and expires_at > now() and approval_token_hash=$3
        returning task_id`,
      [actionId, live.id, hashToken(approvalToken)],
    );
    const row = result.rows[0];
    if (!row) {
      this.send(live, { type: "website_capture.action_denied", actionId, taskId: message.taskId, reason: "动作确认令牌无效、已过期或已使用。" });
      return;
    }
    await this.event(row.task_id, "action_executed", JSON.stringify({ actionId, ok: Boolean(message.ok), message: String(message.message ?? "").slice(0, 500) }));
  }

  async accept(socket: WebSocket, request: FastifyRequest): Promise<void> {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const code = url.searchParams.get("code");
    const sessionToken = url.searchParams.get("session_token");
    const agent = this.parseAgent(request.headers["user-agent"] ?? "");
    const authorized = code
      ? await this.consumePairing(code, agent)
      : sessionToken
        ? await this.resumeSession(sessionToken, agent)
        : null;
    if (!authorized) {
      socket.close(4001, "Invalid or expired pairing");
      return;
    }
    const live: LiveConnection = { ...authorized, ws: socket };
    this.connections.set(live.id, live);
    this.send(live, {
      type: "assistant.connected",
      connectionId: live.id,
      sessionToken: code ? live.sessionToken : undefined,
      disclosure: DISCLOSURE,
      commands: ["capture", "navigate", "scroll", "pause", "stop", "disconnect"],
    });
    socket.on("message", (raw) => {
      const messageBytes = typeof raw === "string" ? Buffer.byteLength(raw) : (raw as Buffer).byteLength;
      if (messageBytes > 64 * 1024 * 1024) {
        socket.close(1009, "Message exceeds the assistant limit");
        return;
      }
      void this.handleMessage(live, raw as Buffer).catch((error) => {
        let taskId = "";
        let messageType = "";
        try {
          const parsed = JSON.parse(Buffer.from(raw as any).toString("utf8"));
          taskId = parsed?.taskId ?? "";
          messageType = parsed?.type ?? "";
        } catch { /* malformed messages are ignored below */ }
        if (taskId && messageType === "desktop_agent.event") void this.failDesktopTask(taskId, error instanceof Error ? error.message : "桌面协作事件处理失败");
        else if (taskId) void this.failTask(live, taskId, error instanceof Error ? error.message : "本地浏览器消息处理失败");
        this.send(live, { type: "assistant.error", message: error instanceof Error ? error.message : "助手消息处理失败" });
      });
    });
    socket.on("close", () => void this.handleClose(live));
    socket.on("error", () => void this.handleClose(live));
  }

  private async consumePairing(code: string, agent: Pick<LiveConnection, "browser" | "platform">) {
    const client = await this.options.db.connect();
    try {
      await client.query("begin");
      const pairing = (await client.query<{ id: string; workspace_id: string; created_by: string }>(
        `select id,workspace_id,created_by from website_capture_pairings
          where code_hash=$1 and used_at is null and revoked_at is null and expires_at > now() for update`,
        [hashToken(code)],
      )).rows[0];
      if (!pairing) {
        await client.query("rollback");
        return null;
      }
      const sessionToken = randomBytes(32).toString("base64url");
      const connectionId = randomUUID();
      await client.query(
        `insert into website_capture_connections(id,pairing_id,workspace_id,user_id,session_token_hash,browser,platform)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [connectionId, pairing.id, pairing.workspace_id, pairing.created_by, hashToken(sessionToken), agent.browser, agent.platform],
      );
      await client.query("update website_capture_pairings set used_at=now() where id=$1", [pairing.id]);
      await client.query("commit");
      return { id: connectionId, userId: pairing.created_by, sessionToken, ...agent, paused: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async resumeSession(sessionToken: string, agent: Pick<LiveConnection, "browser" | "platform">) {
    const { rows } = await this.options.db.query<{ id: string; user_id: string; browser: LiveConnection["browser"]; platform: LiveConnection["platform"]; paused: boolean }>(
      `select id,user_id,browser,platform,paused from website_capture_connections
        where session_token_hash=$1 and revoked_at is null`,
      [hashToken(sessionToken)],
    );
    const row = rows[0];
    if (!row) return null;
    await this.options.db.query("update website_capture_connections set last_seen_at=now(), disconnected_at=null where id=$1", [row.id]);
    return { id: row.id, userId: row.user_id, sessionToken, browser: agent.browser === "unknown" ? row.browser : agent.browser, platform: agent.platform === "unknown" ? row.platform : agent.platform, paused: row.paused };
  }

  private async handleMessage(live: LiveConnection, raw: Buffer | string) {
    let message: any;
    try { message = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw as any).toString("utf8")); } catch { return; }
    await this.options.db.query("update website_capture_connections set last_seen_at=now() where id=$1 and revoked_at is null", [live.id]);
    if (message?.type === "assistant.heartbeat") return;
    if (message?.type === "assistant.pause") return this.setPaused(live, true);
    if (message?.type === "assistant.resume") return this.setPaused(live, false);
    if (message?.type === "assistant.disconnect") return this.revokeConnection(live);
    if (message?.type === "assistant.ready") {
      live.browser = this.parseBrowser(message.browser);
      live.platform = this.parsePlatform(message.platform);
      await this.options.db.query("update website_capture_connections set browser=$2,platform=$3 where id=$1", [live.id, live.browser, live.platform]);
      return;
    }
    if (message?.type === "website_capture.progress") return this.updateProgress(live, message);
    if (message?.type === "website_capture.page") return this.capturePage(live, message);
    if (message?.type === "website_capture.complete") return this.completeTask(live, message);
    if (message?.type === "website_capture.recording_failed") return this.event(String(message.taskId ?? ""), "recording_failed", String(message.message ?? "本地录屏不可用"));
    if (message?.type === "website_capture.failed") return this.failTask(live, String(message.taskId ?? ""), String(message.message ?? "本地浏览器任务失败"));
    if (message?.type === "website_capture.action_result") return this.consumeApprovedAction(live, message);
    if (message?.type === "desktop_agent.event") return this.handleDesktopAgentEvent(live, message);
    if (message?.type === "website_capture.side_effect") {
      this.send(live, { type: "website_capture.action_denied", taskId: message.taskId, reason: "副作用动作必须由当前用户在确认卡中明确批准。" });
    }
    if (message?.type === "website_capture.action_request") {
      const decision = classifyWebsiteAction(message.action as WebsiteActionRequest);
      const task = await this.loadLocalTask(live, String(message.taskId ?? ""));
      if (!task) return;
      if (decision.state === "deny") {
        this.send(live, { type: "website_capture.action_denied", taskId: task.id, action: message.action, reason: decision.reason });
        return;
      }
      if (decision.state === "allow") {
        this.send(live, { type: "website_capture.action_execute", taskId: task.id, action: message.action });
        return;
      }
      const action = await this.options.db.query<{ id: string }>(
        `insert into website_capture_actions(task_id,workspace_id,user_id,connection_id,action,reason)
         values($1,$2,$3,$4,$5::jsonb,$6) returning id`,
        [task.id, task.workspace_id, live.userId, live.id, JSON.stringify(message.action), decision.reason],
      );
      const actionId = action.rows[0]?.id;
      if (!actionId) throw new Error("无法创建动作确认。");
      await this.event(task.id, "action_confirmation", JSON.stringify({ actionId, action: message.action, reason: decision.reason }));
      this.send(live, { type: "website_capture.action_confirmation_required", actionId, taskId: task.id, action: message.action, reason: decision.reason });
    }
  }

  private async handleDesktopAgentEvent(live: LiveConnection, raw: unknown) {
    const parsed = desktopAgentEventSchema.safeParse(raw);
    if (!parsed.success) {
      this.send(live, { type: "assistant.error", message: "桌面协作事件格式无效。" });
      return;
    }
    const event = parsed.data;
    const result = await this.options.db.query<{ id: string; status: string; workspace_id: string; created_by: string; target_url: string | null; goal: string; capabilities: DesktopCapability[] }>(
      `select id,status,workspace_id,created_by,target_url,goal,capabilities from desktop_agent_tasks where id=$1 and created_by=$2 and connection_id=$3`,
      [event.taskId, live.userId, live.id],
    );
    const task = result.rows[0];
    if (!task || !["queued", "running"].includes(task.status)) return;
    if (event.eventType === "approval_required") {
      const action = event.action;
      if (!action || !["click", "type"].includes(action.kind) || !isDesktopActionAuthorized(action, task.capabilities) || isDesktopCredentialField(action.fieldType) || action.approvalToken) {
        await this.options.db.query("insert into desktop_agent_events(task_id,event_type,detail) values($1,'failed',$2)", [event.taskId, "拒绝不支持或涉及凭据的桌面动作"]);
        this.send(live, { type: "desktop_agent.action_denied", taskId: event.taskId, requestId: action?.requestId, reason: "凭据字段或该动作类型禁止自动化。" });
        return;
      }
      const approval = await this.options.db.query<{ id: string; expires_at: string | Date }>(
        `insert into desktop_agent_approvals(task_id,workspace_id,user_id,connection_id,request_id,action)
         select t.id,t.workspace_id,t.created_by,t.connection_id,$2,$3::jsonb
           from desktop_agent_tasks t where t.id=$1 and t.status in ('queued','running')
         on conflict(task_id,request_id) do update set request_id=excluded.request_id
          where desktop_agent_approvals.status='pending' and desktop_agent_approvals.expires_at>now()
            and desktop_agent_approvals.action=excluded.action
         returning id,expires_at`,
        [event.taskId, action.requestId, JSON.stringify(action)],
      );
      const approvalRow = approval.rows[0];
      if (!approvalRow) return;
      const approvalId = approvalRow.id;
      const expiresAt = new Date(approvalRow.expires_at).toISOString();
      const detail = event.detail ?? "桌面 Agent 请求执行一个需要批准的动作。";
      await this.options.db.query(
        "insert into desktop_agent_events(task_id,event_type,detail,payload) values($1,'approval_required',$2,$3::jsonb)",
        [event.taskId, detail, JSON.stringify({ approvalId, action, expiresAt })],
      );
      this.send(live, { type: "desktop_agent.approval_pending", taskId: event.taskId, approvalId, action, expiresAt, detail });
      return;
    }
    let screenshotAsset: { assetId: string; url: string } | undefined;
    const screenshotBase64 = event.result?.screenshotBase64;
    if (screenshotBase64) {
      const screenshot = decodeJpegPayload(screenshotBase64, MAX_SCREENSHOT_BYTES);
      const sourceUrl = event.result?.page?.url ?? task.target_url ?? "";
      const asset = await persistCaptureAsset({
        db: this.options.db,
        storage: this.options.storage,
        storageRoot: this.options.storageRoot,
        webOrigin: this.options.webOrigin,
        task: {
          id: task.id,
          workspace_id: task.workspace_id,
          created_by: task.created_by,
          start_url: sourceUrl,
          page_limit: 1,
          record_video: false,
        },
        bytes: screenshot,
        mimeType: "image/jpeg",
        mediaType: "image",
        title: `Desktop Agent screenshot: ${String(event.result?.page?.title ?? task.goal).slice(0, 120)}`,
        metadata: { ...(sourceUrl ? { sourceUrl } : {}), captureMode: "desktop_agent", taskId: task.id },
      });
      screenshotAsset = { assetId: asset.id, url: asset.url };
    }
    const safeResult = {
      ...(event.result?.page ? { page: event.result.page } : {}),
      ...(screenshotAsset ? { screenshotAsset } : {}),
    };
    const safeAction = event.action ? { ...event.action, approvalToken: undefined } : undefined;
    if (event.approvalId && event.action?.approvalToken) {
      const consumed = await this.options.db.query<{ id: string }>(
        `update desktop_agent_approvals set status='executed',consumed_at=now()
          where id=$1 and task_id=$2 and connection_id=$3 and status='approved' and expires_at>now() and approval_token_hash=$4
          returning id`,
        [event.approvalId, event.taskId, live.id, hashToken(event.action.approvalToken)],
      );
      if (!consumed.rows[0]) return;
    }
    await this.options.db.query(
      "insert into desktop_agent_events(task_id,event_type,detail,payload) values($1,$2,$3,$4::jsonb)",
      [event.taskId, event.eventType, event.detail ?? null, JSON.stringify({ progress: event.progress, result: safeResult, action: safeAction, approvalId: event.approvalId })],
    );
    const terminal = event.eventType === "completed" || event.eventType === "failed";
    await this.options.db.query(
      `update desktop_agent_tasks set status=$2,result=case when $3 then $4::jsonb when $6::jsonb <> '{}'::jsonb then coalesce(result,'{}'::jsonb) || $6::jsonb else result end,error_message=case when $2='failed' then $5 else null end,completed_at=case when $3 then now() else completed_at end,updated_at=now() where id=$1`,
      [event.taskId, event.eventType === "failed" ? "failed" : event.eventType === "completed" ? "succeeded" : "running", terminal, JSON.stringify(safeResult), event.detail ?? null, JSON.stringify(safeResult)],
    );
    if (terminal) {
      this.clearDesktopTaskTimer(event.taskId);
      await this.options.db.query("update desktop_agent_approvals set status='expired' where task_id=$1 and status='pending'", [event.taskId]);
    }
  }

  private async failDesktopTask(taskId: string, message: string) {
    await this.options.db.query("update desktop_agent_tasks set status='failed',error_message=$2,updated_at=now(),completed_at=now() where id=$1 and status in ('queued','running')", [taskId, message]);
    await this.options.db.query("update desktop_agent_approvals set status='expired' where task_id=$1 and status='pending'", [taskId]);
    await this.options.db.query("insert into desktop_agent_events(task_id,event_type,detail) values($1,'failed',$2)", [taskId, message]);
    this.clearDesktopTaskTimer(taskId);
  }

  private clearDesktopTaskTimer(taskId: string) {
    const timer = this.desktopTaskTimers.get(taskId);
    if (timer) clearTimeout(timer);
    this.desktopTaskTimers.delete(taskId);
  }

  private async capturePage(live: LiveConnection, message: any) {
    const task = await this.loadLocalTask(live, message.taskId);
    if (!task || task.status === "canceled") return;
    const pages = this.pages.get(task.id) ?? [];
    if (pages.length >= task.page_limit) return;
    const url = validateLocalCapturedUrl(String(message.page?.url ?? ""), task.start_url, task.follow_external);
    const screenshot = decodeJpegPayload(String(message.screenshotBase64 ?? ""), MAX_SCREENSHOT_BYTES);
    const asset = await persistCaptureAsset({
      db: this.options.db,
      storage: this.options.storage,
      storageRoot: this.options.storageRoot,
      webOrigin: this.options.webOrigin,
      task,
      bytes: screenshot,
      mimeType: "image/jpeg",
      mediaType: "image",
      title: `Website screenshot ${pages.length + 1}: ${String(message.page?.title ?? url.hostname).slice(0, 160)}`,
      metadata: { sourceUrl: url.toString(), captureMode: "local" },
    });
    const page: WebsiteCapturePage = {
      url: url.toString(),
      title: String(message.page?.title ?? url.hostname).slice(0, 500),
      description: String(message.page?.description ?? "").slice(0, 500),
      headings: Array.isArray(message.page?.headings) ? message.page.headings.map(String).slice(0, 16) : [],
      navigation: Array.isArray(message.page?.navigation) ? message.page.navigation.map(String).slice(0, 24) : [],
      assetId: asset.id,
      screenshotUrl: asset.url,
    };
    pages.push(page);
    this.pages.set(task.id, pages);
    await this.options.db.query("update website_capture_tasks set progress=$2, stage='page_loading', updated_at=now() where id=$1 and status='running'", [task.id, 10 + Math.round((pages.length / task.page_limit) * 65)]);
    await this.event(task.id, "page_loading", `已保存第 ${pages.length} 个页面证据：${page.url}`);
  }

  private async completeTask(live: LiveConnection, message: any) {
    const task = await this.loadLocalTask(live, message.taskId);
    if (!task || task.status === "canceled") return;
    const pages = this.pages.get(task.id) ?? [];
    if (!pages.length) return this.failTask(live, task.id, "本地浏览器没有返回页面证据。");
    let recordingAsset: { id: string; url: string } | undefined;
    if (message.recordingBase64) {
      const encoded = String(message.recordingBase64);
      if (encoded.length > Math.ceil(MAX_RECORDING_BYTES * 1.38)) return this.failTask(live, task.id, "本地录屏超过 40 MB 限制。");
      const recording = Buffer.from(encoded.includes(",") ? encoded.slice(encoded.indexOf(",") + 1) : encoded, "base64");
      if (recording.length > MAX_RECORDING_BYTES) return this.failTask(live, task.id, "本地录屏超过 40 MB 限制。");
      recordingAsset = await persistCaptureAsset({
        db: this.options.db,
        storage: this.options.storage,
        storageRoot: this.options.storageRoot,
        webOrigin: this.options.webOrigin,
        task,
        bytes: recording,
        mimeType: "video/webm",
        mediaType: "video",
        title: `Website browsing recording: ${pages[0]?.title ?? new URL(task.start_url).hostname}`,
        metadata: { sourceUrl: task.start_url, captureMode: "local", pageCount: pages.length },
      });
    }
    const result = {
      title: pages[0]?.title || new URL(task.start_url).hostname,
      introduction: buildWebsiteIntroduction(task.start_url, pages),
      startUrl: task.start_url,
      pages,
      ...(recordingAsset ? { recordingAssetId: recordingAsset.id, recordingUrl: recordingAsset.url } : {}),
      completedAt: new Date().toISOString(),
    };
    await this.options.db.query("update website_capture_tasks set status='succeeded', progress=100, stage='completed', result=$2::jsonb, completed_at=now(), updated_at=now() where id=$1 and status='running'", [task.id, JSON.stringify(result)]);
    await this.options.db.query("update website_capture_actions set status='expired' where task_id=$1 and status='pending'", [task.id]);
    await this.event(task.id, "completed", "本地浏览证据与中文介绍已保存");
    this.pages.delete(task.id);
    this.clearTaskTimer(task.id);
  }

  private async updateProgress(live: LiveConnection, message: any) {
    const task = await this.loadLocalTask(live, message.taskId);
    if (!task || task.status === "canceled") return;
    const progress = Math.max(0, Math.min(99, Number(message.progress) || 0));
    const stage = String(message.stage ?? "browsing").slice(0, 80);
    await this.options.db.query("update website_capture_tasks set progress=$2, stage=$3, updated_at=now() where id=$1 and status='running'", [task.id, progress, stage]);
    await this.event(task.id, stage, String(message.detail ?? "").slice(0, 500));
  }

  private async failTask(live: LiveConnection, taskId: string, message: string) {
    if (!taskId) return;
    await this.options.db.query("update website_capture_tasks set status='failed', stage='failed', error_message=$2, updated_at=now() where id=$1 and assistant_connection_id=$3 and status in ('queued','running')", [taskId, message.slice(0, 1000), live.id]);
    await this.options.db.query("update website_capture_actions set status='expired' where task_id=$1 and status='pending'", [taskId]);
    await this.event(taskId, "failed", message);
    this.pages.delete(taskId);
    this.clearTaskTimer(taskId);
  }

  private async loadLocalTask(live: LiveConnection, taskId: string): Promise<LocalTask | null> {
    const { rows } = await this.options.db.query<LocalTask>(
      `select id,workspace_id,created_by,start_url,page_limit,record_video,status,assistant_connection_id,follow_external
         from website_capture_tasks where id=$1 and created_by=$2 and assistant_connection_id=$3 and mode='local'`,
      [taskId, live.userId, live.id],
    );
    return rows[0] ?? null;
  }

  private async handleClose(live: LiveConnection) {
    this.connections.delete(live.id);
    await this.options.db.query("update website_capture_connections set disconnected_at=now(), last_seen_at=now() where id=$1 and revoked_at is null", [live.id]);
    const desktopTasks = await this.options.db.query<{ id: string }>("update desktop_agent_tasks set status='failed',error_message='本地桌面助手已断开，任务已中止',updated_at=now(),completed_at=now() where connection_id=$1 and status in ('queued','running') returning id", [live.id]);
    for (const task of desktopTasks.rows) {
      this.clearDesktopTaskTimer(task.id);
      await this.options.db.query("update desktop_agent_approvals set status='expired' where task_id=$1 and status='pending'", [task.id]);
      await this.options.db.query("insert into desktop_agent_events(task_id,event_type,detail) values($1,'failed',$2)", [task.id, "本地桌面助手已断开，任务已中止"]);
    }
    const tasks = await this.options.db.query<{ id: string }>("update website_capture_tasks set status='failed', stage='failed', error_message='本地浏览器助手已断开，任务已中止', updated_at=now() where assistant_connection_id=$1 and status in ('queued','running') returning id", [live.id]);
    for (const task of tasks.rows) {
      this.clearTaskTimer(task.id);
      await this.event(task.id, "failed", "本地浏览器助手已断开，任务已中止");
    }
  }

  private async setPaused(live: LiveConnection, paused: boolean) {
    live.paused = paused;
    await this.options.db.query("update website_capture_connections set paused=$2,last_seen_at=now() where id=$1", [live.id, paused]);
    this.send(live, { type: "assistant.state", paused });
  }

  private async revokeConnection(live: LiveConnection) {
    await this.options.db.query("update website_capture_connections set revoked_at=now(),disconnected_at=now() where id=$1", [live.id]);
    this.send(live, { type: "assistant.revoked" });
    live.ws.close(4004, "Disconnected by user");
  }

  private async event(taskId: string, stage: string, detail: string) {
    await this.options.db.query("insert into website_capture_events(task_id,stage,detail) values($1,$2,$3)", [taskId, stage.slice(0, 80), detail.slice(0, 1000)]);
  }

  private clearTaskTimer(taskId: string) {
    const timer = this.taskTimers.get(taskId);
    if (timer) clearTimeout(timer);
    this.taskTimers.delete(taskId);
  }

  private send(live: LiveConnection, message: Record<string, unknown>) {
    if (live.ws.readyState === 1) live.ws.send(JSON.stringify(message));
  }

  private wssUrl() {
    const url = new URL(this.options.webOrigin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/website-capture/assistant/ws";
    url.search = "";
    return url.toString();
  }

  private parseAgent(value: string): Pick<LiveConnection, "browser" | "platform"> {
    return { browser: this.parseBrowser(value), platform: this.parsePlatform(value) };
  }

  private parseBrowser(value: unknown): LiveConnection["browser"] {
    const text = String(value ?? "").toLowerCase();
    return text.includes("edg/") || text.includes("edge") ? "edge" : text.includes("chrome") ? "chrome" : "unknown";
  }

  private parsePlatform(value: unknown): LiveConnection["platform"] {
    const text = String(value ?? "").toLowerCase();
    return text.includes("windows") ? "windows" : text.includes("mac") || text.includes("darwin") ? "macos" : text.includes("linux") ? "linux" : "unknown";
  }
}

function isDesktopCredentialField(fieldType: string | undefined) {
  return ["password", "otp", "one-time-code", "verification-code"].includes((fieldType ?? "").toLowerCase());
}

export function validateLocalExactUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("请输入准确的本地网站 URL。"); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("本地助手只允许 HTTP(S) URL。");
  if (url.username || url.password) throw new Error("URL 不得包含用户名或密码。");
  url.hash = "";
  return url;
}

function validateLocalCapturedUrl(input: string, startUrl: string, followExternal: boolean): URL {
  const url = validateLocalExactUrl(input);
  const start = new URL(startUrl);
  const isPrivateHost = (hostname: string) => {
    const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local") || value.endsWith(".internal")) return true;
    if (value === "::1" || value === "0.0.0.0" || value.startsWith("127.")) return true;
    if (/^10\./.test(value) || /^192\.168\./.test(value) || /^169\.254\./.test(value)) return true;
    const private172 = value.match(/^172\.(\d{1,3})\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
    return /^(fc|fd|fe80):/i.test(value);
  };
  if (isPrivateHost(url.hostname) && url.hostname.toLowerCase() !== start.hostname.toLowerCase()) throw new Error("自动跟链不得扩展到新的本地主机。");
  if (!followExternal && url.hostname.toLowerCase() !== start.hostname.toLowerCase()) throw new Error("当前任务未授权跟随外域页面。");
  return url;
}

export async function registerWebsiteAssistantWsRoute(app: FastifyInstance, hub: WebsiteAssistantHub) {
  app.get("/api/website-capture/assistant/ws", { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    void hub.accept(socket, request);
  });
}
