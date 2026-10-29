import { describe, expect, it, vi } from "vitest";

import { WebsiteAssistantHub } from "./assistant-hub.js";

type HubInternals = {
  connections: Map<string, unknown>;
  expireDesktopAgentApprovals(userId: string, workspaceId: string, taskId?: string): Promise<void>;
  recoverDesktopAgentTasks(live: unknown): Promise<void>;
  clearDesktopTaskTimer(taskId: string): void;
  warnDesktopTaskDeadline(taskId: string, live: unknown): Promise<void>;
  consumeDesktopMcpResult(live: unknown, message: unknown): void;
  rejectPendingMcpCalls(connectionId: string, reason: string): void;
};

function createHub() {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.includes("insert into desktop_mcp_tool_calls"))
      return { rows: [{ id: "audit-1" }] };
    return { rows: [] };
  });
  const hub = new WebsiteAssistantHub({
    db: { query } as never,
    storage: {} as never,
    webOrigin: "https://studio.example.test",
    storageRoot: "/tmp/website-capture-test",
  });
  return { hub, query, internals: hub as unknown as HubInternals };
}

function activeConnection(
  send: (message: Record<string, unknown>) => void,
  mcpTools: Array<{ serverId: string; serverName: string; name: string; inputSchema: Record<string, unknown> }> = [
    {
      serverId: "00000000-0000-0000-0000-000000000002",
      serverName: "Docs",
      name: "search",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    },
  ],
) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    userId: "user-1",
    workspaceId: "00000000-0000-0000-0000-000000000010",
    ws: { readyState: 1, send: (payload: string) => send(JSON.parse(payload)) },
    sessionToken: "unused",
    browser: "chrome",
    platform: "windows",
    clientKind: "desktop-app",
    paused: false,
    mcpTools,
  };
}

describe("desktop MCP bridge", () => {
  it("rejects a second active task on the same desktop connection atomically", async () => {
    const { hub, query, internals } = createHub();
    const connection = activeConnection(vi.fn());
    internals.connections.set(connection.id, connection);
    query
      .mockResolvedValueOnce({ rows: [{ id: connection.id }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await expect(hub.createDesktopAgentTask(connection.userId, connection.workspaceId, {
      goal: "Inspect the current window",
      role: "operator",
      capabilities: ["screen.read"],
      executionMode: "windows_ui",
      plannedActions: [],
      maxDurationSeconds: 300,
      pageLimit: 3,
    })).rejects.toThrow("already running on this connection");

    const insert = query.mock.calls.find(([sql]) => String(sql).includes("insert into desktop_agent_tasks"));
    expect(insert?.[0]).toContain("pg_advisory_xact_lock");
    expect(insert?.[0]).toContain("status in ('queued','running')");
  });

  it("expires pending approvals, fails the paused task, and notifies the desktop", async () => {
    const { hub, query, internals } = createHub();
    const send = vi.fn();
    const connection = activeConnection(send);
    internals.connections.set(connection.id, connection);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("update desktop_agent_approvals a set status='expired'")) {
        return { rows: [{ id: "approval-1", task_id: "task-1", action: { kind: "click" }, expires_at: "2026-10-26T00:00:00.000Z" }] } as never;
      }
      if (sql.includes("update desktop_agent_tasks set status='failed'")) return { rows: [{ connection_id: connection.id }] } as never;
      return { rows: [] } as never;
    });

    await internals.expireDesktopAgentApprovals(connection.userId, connection.workspaceId, "task-1");

    expect(query).toHaveBeenCalledWith(expect.stringContaining("approval_expired"), expect.any(Array));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "desktop_agent.approval_expired" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "desktop_agent.stop" }));
  });

  it("warns before forcing a timed-out task to stop", async () => {
    const { query, internals } = createHub();
    const send = vi.fn();
    const connection = activeConnection(send);
    internals.connections.set(connection.id, connection);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("select status from desktop_agent_tasks where id=$1 and connection_id=$2")) return { rows: [{ status: "running" }] } as never;
      if (sql.includes("update desktop_agent_tasks set status='failed'")) return { rows: [{ id: "task-1" }] } as never;
      return { rows: [] } as never;
    });
    vi.useFakeTimers();
    try {
      await internals.warnDesktopTaskDeadline("task-1", connection);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "desktop_agent.deadline_warning" }));
      await vi.advanceTimersByTimeAsync(75_000);

      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "desktop_agent.stop" }));
      expect(query).toHaveBeenCalledWith(expect.stringContaining("event_type,detail) values($1,'failed'"), expect.any(Array));
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a server/tool not advertised by the authorized connection", async () => {
    const { hub, query, internals } = createHub();
    internals.connections.set(
      "00000000-0000-0000-0000-000000000001",
      activeConnection(vi.fn()),
    );

    await expect(
      hub.callDesktopMcpTool({
        userId: "user-1",
        workspaceId: "00000000-0000-0000-0000-000000000010",
        serverId: "00000000-0000-0000-0000-000000000002",
        toolName: "delete_everything",
        arguments: {},
      }),
    ).rejects.toThrow("no longer available");
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("insert into desktop_mcp_tool_calls"),
      expect.anything(),
    );
  });

  it("blocks direct native MCP actions so they cannot bypass task approvals", async () => {
    const { hub, query, internals } = createHub();
    const connection = activeConnection(vi.fn(), [{
      serverId: "00000000-0000-0000-0000-000000000003",
      serverName: "Native Screen",
      name: "screen_click",
      inputSchema: { type: "object", properties: { target: { type: "string" } } },
    }]);
    internals.connections.set(connection.id, connection);

    await expect(hub.callDesktopMcpTool({
      userId: connection.userId,
      workspaceId: connection.workspaceId,
      serverId: connection.mcpTools[0]!.serverId,
      toolName: "screen_click",
      arguments: { target: "Delete" },
      desktopExecutionContext: { browserMode: "windows_ui", executionMode: "windows_ui" },
    })).rejects.toThrow("requires approval");
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("insert into desktop_mcp_tool_calls"), expect.anything());
  });

  it("rate-limits native screen observations per connection", async () => {
    const { hub, internals } = createHub();
    let connection!: ReturnType<typeof activeConnection>;
    connection = activeConnection((message) => {
      queueMicrotask(() => internals.consumeDesktopMcpResult(connection, {
        type: "desktop.mcp.result", requestId: message.requestId, connectionId: message.connectionId,
        ok: true, result: "Screen inspected.",
      }));
    }, [{
      serverId: "00000000-0000-0000-0000-000000000003",
      serverName: "Native Screen",
      name: "screen_observe",
      inputSchema: { type: "object", properties: {} },
    }]);
    internals.connections.set(connection.id, connection);

    const call = () => hub.callDesktopMcpTool({
      userId: connection.userId,
      workspaceId: connection.workspaceId,
      serverId: connection.mcpTools[0]!.serverId,
      toolName: "screen_observe",
      arguments: {},
      desktopExecutionContext: { browserMode: "windows_ui", executionMode: "windows_ui" },
    });
    for (let attempt = 0; attempt < 12; attempt++) await call();
    await expect(call()).rejects.toThrow("rate limit reached");
  });

  it("reattaches a disconnected native task to the newly connected desktop", async () => {
    const { hub, query, internals } = createHub();
    const sent: Record<string, unknown>[] = [];
    const connection = activeConnection((message) => sent.push(message));
    internals.connections.set(connection.id, connection);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("old_connection_id")) return { rows: [{
        id: "00000000-0000-0000-0000-000000000020",
        old_connection_id: "00000000-0000-0000-0000-000000000021",
        goal: "Inspect the current window",
        role: "operator",
        capabilities: ["screen.read", "window.click"],
        target_url: null,
        canvas_id: null,
        execution_mode: "windows_ui",
        planned_actions: [{ taskId: "00000000-0000-0000-0000-000000000020", requestId: "already-running-action", kind: "native_click" }],
        max_duration_seconds: 300,
        created_at: new Date().toISOString(),
      }] } as never;
      if (sql.includes("update desktop_agent_tasks set connection_id")) return { rows: [{ id: "00000000-0000-0000-0000-000000000020" }] } as never;
      return { rows: [] } as never;
    });

    await internals.recoverDesktopAgentTasks(connection);
    internals.clearDesktopTaskTimer("00000000-0000-0000-0000-000000000020");

    const resume = sent.find((message) => message.type === "desktop_agent.resume");
    expect(resume).toBeDefined();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("set connection_id=$2"), expect.any(Array));
  });

  it("correlates WSS responses, scopes by connection, and audits without arguments", async () => {
    const { hub, query, internals } = createHub();
    const connection = activeConnection((message) => {
      queueMicrotask(() =>
        internals.consumeDesktopMcpResult(connection, {
          type: "desktop.mcp.result",
          requestId: message.requestId,
          connectionId: message.connectionId,
          ok: true,
          result: "Found the requested docs.",
        }),
      );
    });
    internals.connections.set(connection.id, connection);

    await expect(
      hub.callDesktopMcpTool({
        userId: "user-1",
        workspaceId: connection.workspaceId,
        serverId: "00000000-0000-0000-0000-000000000002",
        toolName: "search",
        arguments: { query: "MCP" },
      }),
    ).resolves.toBe("Found the requested docs.");

    const auditCalls = query.mock.calls.filter(([sql]) =>
      sql.includes("desktop_mcp_tool_calls"),
    );
    expect(auditCalls).toHaveLength(2);
    expect(auditCalls[0]?.[1]).toEqual([
      connection.workspaceId,
      connection.userId,
      connection.id,
      "00000000-0000-0000-0000-000000000002",
      "Docs",
      "search",
    ]);
    expect(JSON.stringify(auditCalls)).not.toContain("MCP");
  });

  it("rejects outstanding calls when the desktop connection closes", async () => {
    const { hub, internals } = createHub();
    const send = vi.fn();
    const connection = activeConnection(send);
    internals.connections.set(connection.id, connection);
    const call = hub.callDesktopMcpTool({
      userId: connection.userId,
      workspaceId: connection.workspaceId,
      serverId: "00000000-0000-0000-0000-000000000002",
      toolName: "search",
      arguments: { query: "MCP" },
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    internals.rejectPendingMcpCalls(connection.id, "desktop offline");

    await expect(call).rejects.toThrow("desktop offline");
  });
});
