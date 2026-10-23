import { describe, expect, it, vi } from "vitest";

import { WebsiteAssistantHub } from "./assistant-hub.js";

type HubInternals = {
  connections: Map<string, unknown>;
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

function activeConnection(send: (message: Record<string, unknown>) => void) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    userId: "user-1",
    workspaceId: "00000000-0000-0000-0000-000000000010",
    ws: { readyState: 1, send: (payload: string) => send(JSON.parse(payload)) },
    sessionToken: "unused",
    browser: "chrome",
    platform: "windows",
    paused: false,
    mcpTools: [
      {
        serverId: "00000000-0000-0000-0000-000000000002",
        serverName: "Docs",
        name: "search",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      },
    ],
  };
}

describe("desktop MCP bridge", () => {
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
