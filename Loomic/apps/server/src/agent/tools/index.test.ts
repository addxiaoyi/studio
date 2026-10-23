import { describe, expect, it } from "vitest";

import { createDesktopMcpTools } from "./desktop-mcp.js";
import { createMainAgentTools } from "./index.js";

describe("createMainAgentTools", () => {
  it("registers every tool name once", () => {
    const backend = {} as never;
    const desktopMcpTools = createDesktopMcpTools(
      [
        {
          serverId: "00000000-0000-0000-0000-000000000002",
          serverName: "Local Project",
          name: "read_file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
      async () => "file contents",
    );
    const names = createMainAgentTools(backend, {
      submitWebsiteCapture: async () => ({
        taskId: "00000000-0000-0000-0000-000000000001",
        status: "queued",
        progress: 0,
        pending: true,
      }),
      submitDesktopAgentTask: async () => ({
        taskId: "00000000-0000-0000-0000-000000000002",
        role: "researcher",
        status: "running",
        capabilities: ["browser.read"],
      }),
      desktopMcpTools,
    }).map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => name === "project_search")).toHaveLength(1);
    expect(names).toEqual(
      expect.arrayContaining([
        "inspect_canvas",
        "manipulate_canvas",
        "generate_image",
        "generate_video",
        "persist_sandbox_file",
        "website_capture",
        "desktop_control",
      ]),
    );
    expect(
      names.some((name) => name.startsWith("mcp_00000000_read_file_")),
    ).toBe(true);
  });
});
