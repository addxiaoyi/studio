import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { agentGoalSchema } from "@helstera/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentGoalService } from "./agent-goal-service.js";
import { AgentGoalWorker } from "./agent-goal-worker.js";
import { acceptSuggestion } from "./agent-suggestion-service.js";
import { ReadOnlyGoalPausedError } from "./agent-goal-interruption.js";
import { WebsiteAssistantHub } from "../website-capture/assistant-hub.js";

const enabled = process.env.HELT_AGENT_DB_TEST === "1";

describe.skipIf(!enabled)("Agent goals on isolated PostgreSQL", () => {
  const name = `helstera_agent_test_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Client;
  let db: pg.Pool;
  let goals: AgentGoalService;
  let created = false;
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const canvasId = randomUUID();
  const sessionId = randomUUID();

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Integration tests require a local PostgreSQL server.");
    admin = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis:5_000 });
    await admin.connect();
    await admin.query(`create database "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    db = new pg.Pool({ connectionString: url.toString(), max: 8 });
    const root = new URL("../../local-db/", import.meta.url);
    await db.query(await readFile(new URL("schema.sql", root), "utf8"));
    const files = (await readdir(new URL("migrations/", root))).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      try { await db.query(await readFile(new URL(`migrations/${file}`, root), "utf8")); }
      catch (error) { throw new Error(`Migration failed: ${file}`, { cause: error }); }
    }
    // Replay this feature's incremental migrations to verify their idempotency.
    for (const file of files.filter((file) => file.startsWith("20261031"))) {
      await db.query(await readFile(new URL(`migrations/${file}`, root), "utf8"));
    }
    await db.query("insert into app_users(id,email) values($1,'agent-test@example.test')", [userId]);
    await db.query("insert into workspaces(id,owner_user_id,name) values($1,$2,'Agent test')", [workspaceId,userId]);
    await db.query("insert into workspace_members(workspace_id,user_id) values($1,$2)", [workspaceId,userId]);
    const projectId = randomUUID();
    await db.query("insert into projects(id,workspace_id,created_by,name,slug) values($1,$2,$3,'Test','agent-test')", [projectId,workspaceId,userId]);
    await db.query("insert into canvases(id,project_id,created_by,name) values($1,$2,$3,'Test')", [canvasId,projectId,userId]);
    await db.query("insert into chat_sessions(id,canvas_id,created_by,thread_id) values($1,$2,$3,'test')", [sessionId,canvasId,userId]);
    goals = new AgentGoalService(db);
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    try {
      if (created) {
        if (!/^helstera_agent_test_[a-f0-9]{32}$/.test(name)) throw new Error("Unsafe temporary database name.");
        await admin.query(`drop database "${name}"`);
      }
    } finally { await admin?.end(); }
  });

  const create = () => goals.create(userId, workspaceId, {
    goal: "Read https://example.test and summarize it", canvasId, chatSessionId: sessionId,
    executionMode: "isolated_browser", idempotencyKey: randomUUID(),
  });

  it("binds desktop approval receipts to exact actions, expiry and one-time consumption", async () => {
    const goal = await create();
    const pairingId = randomUUID();
    const connectionId = randomUUID();
    const taskId = randomUUID();
    const action = { taskId, requestId: "action-1", kind: "native_click", x: 10, y: 20 };
    await db.query("insert into website_capture_pairings(id,workspace_id,created_by,code_hash,expires_at) values($1,$2,$3,$4,now()+interval '1 hour')", [pairingId, workspaceId, userId, randomUUID()]);
    await db.query("insert into website_capture_connections(id,pairing_id,workspace_id,user_id,session_token_hash) values($1,$2,$3,$4,$5)", [connectionId, pairingId, workspaceId, userId, randomUUID()]);
    await db.query("insert into desktop_agent_tasks(id,workspace_id,created_by,connection_id,goal,role,capabilities,status) values($1,$2,$3,$4,'Test','operator',$5::jsonb,'running')", [taskId, workspaceId, userId, connectionId, JSON.stringify(["window.click"])]);
    await db.query("update desktop_agent_tasks set goal_id=$2,execution_mode='windows_ui' where id=$1", [taskId, goal.id]);
    const sent: Array<Record<string, unknown>> = [];
    const live = { id: connectionId, userId, workspaceId, paused: false, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
    const hub = new WebsiteAssistantHub({ db, storage: {} as never, webOrigin: "https://example.test", storageRoot: "." });
    const internals = hub as unknown as { connections: Map<string, unknown>; handleDesktopAgentEvent(live: unknown, event: unknown): Promise<void>; recoverDesktopAgentTasks(live: unknown): Promise<void> };
    internals.connections.set(connectionId, live);
    const windowIdentity = { windowId: "ab12", pid: 42, processStarted: "133000000000000000" };
    await internals.handleDesktopAgentEvent(live, { taskId, eventType: "step", stepId: "inspect-native-window", result: { windowIdentity } });
    expect((await db.query("select checkpoint from desktop_agent_tasks where id=$1", [taskId])).rows[0].checkpoint.windowIdentity).toEqual(windowIdentity);
    await internals.handleDesktopAgentEvent(live, { taskId, eventType: "approval_required", action });
    const approvalId = (await db.query<{ id: string }>("select id from desktop_agent_approvals where task_id=$1", [taskId])).rows[0]!.id;
    await db.query("insert into agent_connector_permissions(id,workspace_id,user_id,connector_id,enabled,permissions) values($1,$2,$3,'desktop-agent',false,'[]'::jsonb)", [randomUUID(), workspaceId, userId]);
    await expect(hub.approveDesktopAction(userId, workspaceId, approvalId)).rejects.toThrow("desktop-agent connector is disabled");
    expect(sent.some((message) => message.type === "desktop_agent.action")).toBe(false);
    await db.query("update agent_connector_permissions set enabled=true where workspace_id=$1 and user_id=$2 and connector_id='desktop-agent'", [workspaceId, userId]);
    await hub.approveDesktopAction(userId, workspaceId, approvalId);
    expect((await db.query("select checkpoint from desktop_agent_tasks where id=$1", [taskId])).rows[0].checkpoint.action).toMatchObject({ approvalId, requestId: action.requestId, state: "dispatched" });
    await db.query("update desktop_agent_tasks set status='waiting_desktop' where id=$1", [taskId]);
    await db.query("update agent_goals set status='waiting_desktop' where id=$1", [goal.id]);
    await internals.recoverDesktopAgentTasks(live);
    expect(sent.some((message) => message.type === "desktop_agent.stop" && message.taskId === taskId)).toBe(true);
    expect(sent.some((message) => message.type === "desktop_agent.resume")).toBe(false);
    expect((await db.query("select status from desktop_agent_tasks where id=$1", [taskId])).rows[0].status).toBe("waiting_desktop");
    await expect(goals.transition(userId, workspaceId, goal.id, "resume")).rejects.toThrow("unknown outcome");
    await db.query("update desktop_agent_tasks set status='waiting_approval' where id=$1", [taskId]);
    const approved = sent.find((message) => message.type === "desktop_agent.action")!.action as typeof action & { approvalId: string; approvalToken: string };
    const receipt = (receiptAction: typeof approved) => internals.handleDesktopAgentEvent(live, { taskId, eventType: "progress", approvalId, action: receiptAction });
    const status = async () => (await db.query<{ status: string }>("select status from desktop_agent_approvals where id=$1", [approvalId])).rows[0]!.status;
    await receipt({ ...approved, x: 11 });
    expect(await status()).toBe("approved");
    await db.query("update desktop_agent_approvals set expires_at=now()-interval '1 second' where id=$1", [approvalId]);
    await receipt(approved);
    expect(await status()).toBe("approved");
    await db.query("update desktop_agent_approvals set expires_at=now()+interval '1 minute' where id=$1", [approvalId]);
    await db.query("alter table desktop_agent_events add constraint test_reject_action_receipt check (event_type <> 'action_receipt') not valid");
    try {
      await expect(receipt(approved)).rejects.toThrow();
      expect(await status()).toBe("approved");
      expect((await db.query("select checkpoint from desktop_agent_tasks where id=$1", [taskId])).rows[0].checkpoint.action.state).toBe("dispatched");
      expect(sent.some((message) => message.type === "desktop_agent.action_recorded")).toBe(false);
    } finally {
      await db.query("alter table desktop_agent_events drop constraint test_reject_action_receipt");
    }
    await receipt(approved);
    expect(await status()).toBe("executed");
    expect((await db.query("select checkpoint from desktop_agent_tasks where id=$1", [taskId])).rows[0].checkpoint.action.state).toBe("completed");
    expect(sent.filter((message) => message.type === "desktop_agent.action_recorded")).toHaveLength(1);
    await receipt(approved);
    const events = await db.query("select id from desktop_agent_events where task_id=$1 and event_type='progress'", [taskId]);
    expect(events.rows).toHaveLength(1);
    const receipts = await db.query("select payload from desktop_agent_events where task_id=$1 and event_type='action_receipt'", [taskId]);
    expect(receipts.rows).toHaveLength(1);
    expect(receipts.rows[0].payload).toMatchObject({ approvalId, requestId: action.requestId, kind: action.kind, state: "completed" });
    expect(sent.filter((message) => message.type === "desktop_agent.action_recorded")).toHaveLength(1);
    await db.query("update desktop_agent_tasks set status='failed',checkpoint=jsonb_set(checkpoint,'{action,state}',to_jsonb('uncertain'::text)) where id=$1", [taskId]);
    await db.query("update agent_goals set status='failed' where id=$1", [goal.id]);
    await db.query("update website_capture_connections set disconnected_at=null where id=$1", [connectionId]);
    expect((await goals.get(userId, workspaceId, goal.id)).tasks[0]?.reviewAvailable).toBe(false);
    await expect(goals.transition(userId, workspaceId, goal.id, "retry")).rejects.toThrow("automatic replay is not safe");
    await expect(goals.reviewInterruptedAction(userId, workspaceId, goal.id, approvalId, "observed_completed")).rejects.toThrow("No disconnected action");
    await db.query("update website_capture_connections set disconnected_at=now() where id=$1", [connectionId]);
    expect((await goals.get(userId, workspaceId, goal.id)).tasks[0]?.reviewAvailable).toBe(true);
    await expect(goals.reviewInterruptedAction(randomUUID(), workspaceId, goal.id, approvalId, "observed_completed")).rejects.toThrow("No disconnected action");
    await expect(goals.reviewInterruptedAction(userId, workspaceId, goal.id, approvalId, "observed_completed")).resolves.toMatchObject({ taskId, replayed: false });
    expect((await goals.get(userId, workspaceId, goal.id)).tasks[0]?.reviewAvailable).toBe(false);
    await expect(goals.reviewInterruptedAction(userId, workspaceId, goal.id, approvalId, "observed_completed")).rejects.toThrow("already reviewed");
    await expect(goals.transition(userId, workspaceId, goal.id, "retry")).rejects.toThrow("automatic replay is not safe");
  });

  it("requires confirmation, dispatches only once across workers, and writes outputs/chat once", async () => {
    const goal = await create();
    expect(agentGoalSchema.safeParse(goal).success).toBe(true);
    let started!: () => void;
    let complete!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { complete = resolve; });
    const document = {
      id: `${goal.id}:website-report`, title: "Verified report", fileName: "website-report.md",
      mimeType: "text/markdown", content: "# Verified\nObserved evidence only.", sourceUrls: ["https://example.test/"],
    };
    const executor = vi.fn(async () => { started(); await gate; return { summary: "Verified", documents: [document], localPaths: ["D:/test-assets/result.txt"] }; });
    const dispatcher = { createDesktopAgentTask: vi.fn() };
    const first = new AgentGoalWorker(db, dispatcher, 1_000, executor);
    const second = new AgentGoalWorker(db, dispatcher, 1_000, executor);
    await first.tick();
    expect(executor).not.toHaveBeenCalled();
    await Promise.all([goals.confirm(userId, workspaceId, goal.id), goals.confirm(userId, workspaceId, goal.id)]);
    const running = first.tick();
    try {
      await Promise.race([entered, new Promise((_, reject) => setTimeout(() => reject(new Error("Worker did not start")), 3_000))]);
      await second.tick();
      expect(executor).toHaveBeenCalledOnce();
    } finally { complete(); await running; }
    await second.tick();
    const saved = await goals.get(userId, workspaceId, goal.id);
    expect(agentGoalSchema.safeParse(saved).success).toBe(true);
    expect(saved.status).toBe("completed");
    expect(saved.outputs).toHaveLength(2);
    expect(saved.result?.documents).toEqual([document]);
    expect(saved.outputs.find((output) => output.kind === "document")).toMatchObject({
      status: "pending",
      metadata: { documentId: document.id, saveState: "pending_local" },
    });
    expect(saved.outputs.find((output) => output.kind === "document")?.localPath).toBeUndefined();
    expect(saved.outputs.find((output) => output.kind === "document")?.cloudAssetId).toBeUndefined();
    expect(saved.activities.filter((event) => event.eventType === "goal.confirmed")).toHaveLength(1);
    const messages = await db.query("select id from chat_messages where client_message_id=$1", [`agent-goal:${goal.id}:completed`]);
    expect(messages.rows).toHaveLength(1);
  });

  it("releases a paused read-only capture and restarts it only after explicit resume", async () => {
    const goal = await create();
    await goals.confirm(userId, workspaceId, goal.id);
    let started!: () => void;
    let interrupt!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { interrupt = resolve; });
    const executor = vi.fn()
      .mockImplementationOnce(async () => { started(); await gate; throw new ReadOnlyGoalPausedError(); })
      .mockResolvedValue({ summary: "Read-only capture restarted" });
    const worker = new AgentGoalWorker(db, { createDesktopAgentTask: vi.fn() }, 1_000, executor);
    const running = worker.tick();
    try {
      await Promise.race([entered, new Promise((_, reject) => setTimeout(() => reject(new Error("Worker did not start")), 3_000))]);
      await goals.transition(userId, workspaceId, goal.id, "pause");
    } finally { interrupt(); await running; }
    expect((await goals.get(userId, workspaceId, goal.id)).status).toBe("paused");
    await worker.tick();
    expect(executor).toHaveBeenCalledOnce();
    await goals.transition(userId, workspaceId, goal.id, "resume");
    await worker.tick();
    expect(executor).toHaveBeenCalledTimes(2);
    expect((await goals.get(userId, workspaceId, goal.id)).status).toBe("completed");
  });

  it("rolls back suggestion acceptance on failure and deduplicates concurrent retries", async () => {
    const id = randomUUID();
    await db.query(`insert into agent_suggestions(id,workspace_id,user_id,kind,title,detail,goal,execution_mode,output_kind)
      values($1,$2,$3,'workflow','Test','Test','Prepare a document','windows_ui','document')`, [id,workspaceId,userId]);
    await db.query(`create function reject_test_goal() returns trigger language plpgsql as $$ begin raise exception 'test rollback'; end; $$`);
    await db.query("create trigger reject_test_goal before insert on agent_goals for each row execute function reject_test_goal()");
    try {
      await expect(acceptSuggestion(db,userId,workspaceId,id)).rejects.toThrow("test rollback");
      expect((await db.query("select status from agent_suggestions where id=$1", [id])).rows[0].status).toBe("pending");
    } finally { await db.query("drop trigger reject_test_goal on agent_goals; drop function reject_test_goal()"); }
    const accepted = await Promise.all([acceptSuggestion(db,userId,workspaceId,id), acceptSuggestion(db,userId,workspaceId,id)]);
    expect(accepted[0].goal.id).toBe(accepted[1].goal.id);
    expect(accepted[0].goal).toMatchObject({ status: "draft", executionMode: "windows_ui", outputKind: "document" });
  });

  it("recovers incomplete result persistence after a worker restart without executing again", async () => {
    const goal = await create();
    await goals.confirm(userId, workspaceId, goal.id);
    await db.query(`create function reject_test_output() returns trigger language plpgsql as $$ begin raise exception 'output failure'; end; $$`);
    await db.query("create trigger reject_test_output before insert on agent_goal_outputs for each row execute function reject_test_output()");
    const executor = vi.fn().mockResolvedValue({ summary: "Recovered", localPaths: ["D:/test-assets/recovered.txt"] });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await new AgentGoalWorker(db, {} as never, 1_000, executor).tick();
      expect((await goals.get(userId, workspaceId, goal.id)).status).toBe("running");
      expect((await db.query("select id from agent_goal_outputs where goal_id=$1", [goal.id])).rows).toHaveLength(0);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
      await db.query("drop trigger reject_test_output on agent_goal_outputs; drop function reject_test_output()");
    }
    await new AgentGoalWorker(db, {} as never, 1_000, executor).tick();
    expect(executor).toHaveBeenCalledOnce();
    const saved = await goals.get(userId, workspaceId, goal.id);
    expect(saved.status).toBe("completed");
    expect(saved.outputs).toHaveLength(1);
  });

  it("does not turn a canceled in-flight goal into a completed goal", async () => {
    const goal = await create();
    await goals.confirm(userId, workspaceId, goal.id);
    let complete!: () => void;
    const gate = new Promise<void>((resolve) => { complete = resolve; });
    const executor = vi.fn(async () => { await gate; return { summary: "Late completion" }; });
    const run = new AgentGoalWorker(db, {} as never, 1_000, executor).tick();
    try {
      await vi.waitFor(() => expect(executor).toHaveBeenCalledOnce());
      await goals.transition(userId, workspaceId, goal.id, "cancel");
    } finally { complete(); await run; }
    const saved = await goals.get(userId, workspaceId, goal.id);
    expect(saved.status).toBe("canceled");
    expect(saved.activities.some((event) => event.eventType === "goal.completed")).toBe(false);
    expect(saved.activities.some((event) => event.eventType === "completed")).toBe(false);
    expect((await db.query("select id from chat_messages where client_message_id=$1", [`agent-goal:${goal.id}:completed`])).rows).toHaveLength(0);
  });
});
