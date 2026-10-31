import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerAgentConnectorRoutes } from "./agent-connectors.js";

function createApp(query = vi.fn().mockResolvedValue({ rows: [] }), ready = false) {
  const app = Fastify();
  registerAgentConnectorRoutes(app, {
    db: { query } as never,
    auth: { authenticate: vi.fn().mockResolvedValue({ id: "user" }) } as never,
    viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace" } }) } as never,
    assistantHub: { isDesktopReady: () => ready },
  });
  return { app, query };
}

describe("Agent connector permissions", () => {
  it("reports a live authorized desktop connection", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ connector_id: "desktop-agent", enabled: true, permissions: [] }] }).mockResolvedValueOnce({ rows: [] });
    const { app } = createApp(query, true);
    try {
      const response = await app.inject({ method: "GET", url: "/api/agent/connectors" });
      expect(response.json().data).toContainEqual(expect.objectContaining({ id: "desktop-agent", status: "connected" }));
    } finally { await app.close(); }
  });
  it("does not equate enabled settings with desktop or folder readiness", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { connector_id: "desktop-agent", enabled: true, permissions: ["desktop.connected"] },
        { connector_id: "local-files", enabled: true, permissions: ["folder.selected"] },
      ] })
      .mockResolvedValueOnce({ rows: [] });
    const { app } = createApp(query);
    try {
      const response = await app.inject({ method: "GET", url: "/api/agent/connectors" });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "desktop-agent", enabled: true, status: "disconnected" }),
        expect.objectContaining({ id: "local-files", enabled: true, status: "needs_permission" }),
      ]));
    } finally { await app.close(); }
  });

  it.each([["arbitrary.permission"], [123], "folder.selected"])("rejects undeclared or malformed permissions: %j", async (permissions) => {
    const { app, query } = createApp();
    try {
      const response = await app.inject({ method: "PATCH", url: "/api/agent/connectors/local-files", payload: { enabled: true, permissions } });
      expect(response.statusCode).toBe(400);
      expect(query).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
