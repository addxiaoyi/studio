import { describe, expect, it } from "vitest";

import {
  desktopMcpToolCallSchema,
  desktopMcpToolCatalogSchema,
  desktopMcpToolResultSchema,
} from "./desktop-mcp.js";

const connectionId = "00000000-0000-0000-0000-000000000001";
const serverId = "00000000-0000-0000-0000-000000000002";

describe("desktop MCP bridge contracts", () => {
  it("accepts a bounded catalog and rejects a catalog from another connection", () => {
    const message = {
      type: "desktop.mcp.tools",
      connectionId,
      tools: [
        {
          serverId,
          serverName: "Docs",
          name: "search",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ],
    };
    expect(desktopMcpToolCatalogSchema.safeParse(message).success).toBe(true);
    expect(
      desktopMcpToolCatalogSchema.safeParse({
        ...message,
        connectionId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      desktopMcpToolCatalogSchema.safeParse({
        ...message,
        tools: Array.from({ length: 129 }, (_, index) => ({
          ...message.tools[0],
          name: `tool_${index}`,
        })),
      }).success,
    ).toBe(false);
  });

  it("requires a correlated request and bounded result payload", () => {
    const call = {
      type: "desktop.mcp.call",
      requestId: connectionId,
      connectionId,
      serverId,
      toolName: "search",
      arguments: { query: "Helstera" },
    };
    expect(desktopMcpToolCallSchema.safeParse(call).success).toBe(true);
    expect(
      desktopMcpToolCallSchema.safeParse({ ...call, requestId: "bad" }).success,
    ).toBe(false);
    expect(
      desktopMcpToolResultSchema.safeParse({
        type: "desktop.mcp.result",
        requestId: connectionId,
        connectionId,
        ok: true,
        result: "found",
      }).success,
    ).toBe(true);
    expect(
      desktopMcpToolResultSchema.safeParse({
        type: "desktop.mcp.result",
        requestId: connectionId,
        connectionId,
        ok: true,
        result: "x".repeat(128_001),
      }).success,
    ).toBe(false);
  });
});
