import { describe, expect, it, vi } from "vitest";

import { createDesktopMcpTools } from "./desktop-mcp.js";

const serverId = "00000000-0000-0000-0000-000000000002";

describe("desktop MCP Agent tools", () => {
  it("turns a connected MCP tool schema into a validated Agent tool call", async () => {
    const callTool = vi.fn().mockResolvedValue("search results");
    const search = createDesktopMcpTools(
      [
        {
          serverId,
          serverName: "Docs",
          name: "search docs",
          description: "Search documentation.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search terms" },
              limit: { type: "integer", minimum: 1, maximum: 20 },
            },
            required: ["query"],
          },
        },
      ],
      callTool,
    )[0];
    if (!search) throw new Error("The MCP tool fixture did not create an Agent tool.");

    expect(search.name).toMatch(/^mcp_00000000_search_docs_/);
    await expect(search.invoke({ query: "MCP", limit: 5 })).resolves.toBe(
      "search results",
    );
    expect(callTool).toHaveBeenCalledWith({
      serverId,
      toolName: "search docs",
      arguments: { query: "MCP", limit: 5 },
    });
    await expect(search.invoke({ query: 12 })).rejects.toThrow();
  });

  it("rejects unsupported schema references instead of exposing a weak tool schema", () => {
    expect(() =>
      createDesktopMcpTools(
        [
          {
            serverId,
            serverName: "Docs",
            name: "unsafe",
            inputSchema: {
              type: "object",
              properties: { query: { $ref: "#/definitions/query" } },
            },
          },
        ],
        vi.fn(),
      ),
    ).toThrow("unsupported JSON Schema");
  });
});
