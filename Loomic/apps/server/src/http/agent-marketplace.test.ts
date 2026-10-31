import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMarketplaceItemAvailable, registerAgentMarketplaceRoutes } from "./agent-marketplace.js";

const user = { id: "admin-1", accessToken: "token", email: "admin@example.test", userMetadata: {} };

function buildApi(input: { role?: string; authenticated?: boolean; installs?: Array<Record<string, unknown>>; itemKind?: "skill" | "mcp" | "plugin"; installMetadata?: Record<string, unknown> } = {}) {
  const app = Fastify();
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("from app_users")) return { rows: [{ system_role: input.role ?? "admin", workspace_id: "workspace-1" }] };
    if (sql.includes("from agent_marketplace_installs a join")) return { rows: input.installs ?? [] };
    if (sql.includes("from agent_marketplace_items i")) return { rows: [{ id: "item-1", kind: "mcp", name: "Playwright", slug: "playwright", version: "latest", status: "published", manifest: { transport: "stdio", command: "npx", args: ["@playwright/mcp"], token: "must-not-leak" } }] };
    if (sql.includes("select metadata from agent_marketplace_installs")) return { rows: [{ metadata: input.installMetadata ?? {} }] };
    if (sql.includes("from agent_marketplace_items where id=$1")) return { rows: [{ id: "item-1", kind: input.itemKind ?? "mcp", name: "Playwright", version: "0.0.83", status: "published" }] };
    if (sql.includes("from agent_marketplace_installs where workspace_id")) return { rows: [{ item_id: "item-1" }] };
    if (sql.includes("update agent_marketplace_items")) return { rows: [{ id: "item-1", kind: "skill", name: "Frontend Design", version: "1.1", status: "published", manifest: {} }] };
    return { rows: [] };
  });
  registerAgentMarketplaceRoutes(app, {
    auth: { authenticate: vi.fn().mockResolvedValue(input.authenticated === false ? null : user) },
    viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }) } as never,
    db: { query, connect: vi.fn() } as never,
  });
  return { app, query };
}

afterEach(() => vi.restoreAllMocks());

describe("agent marketplace routes", () => {
  it("serves only published items and strips credential fields from public manifests", async () => {
    const { app } = buildApi();
    const response = await app.inject({ method: "GET", url: "/api/agent-marketplace?kind=mcp", headers: { authorization: "Bearer session" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data[0].manifest).toEqual({ transport: "stdio", command: "npx", args: ["@playwright/mcp"] });
    expect(response.json().data[0].installed).toBe(true);
    expect(response.body).not.toContain("must-not-leak");
    await app.close();
  });

  it("requires a local desktop MCP install before syncing it to the workspace", async () => {
    const { app } = buildApi();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent-marketplace/item-1/install",
      headers: { authorization: "Bearer session" },
      payload: { target: "desktop", localInstalled: false },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("mcp_local_install_required");
    await app.close();
  });

  it("blocks users who are not system administrators from managing listings", async () => {
    const { app } = buildApi({ role: "member" });
    const response = await app.inject({ method: "GET", url: "/api/admin/agent-marketplace", headers: { authorization: "Bearer session" } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("rejects secrets in an MCP manifest before opening a database transaction", async () => {
    const { app, query } = buildApi();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/agent-marketplace",
      headers: { authorization: "Bearer session" },
      payload: { kind: "mcp", name: "Unsafe", sourceUrl: "https://github.com/example/mcp", manifest: { transport: "stdio", command: "node", args: ["server.js"], token: "secret" } },
    });
    expect(response.statusCode).toBe(400);
    expect(query.mock.calls.some(([sql]) => sql.includes("insert into agent_marketplace_items"))).toBe(false);
    await app.close();
  });

  it("publishes and audits a listing state change", async () => {
    const { app, query } = buildApi();
    const response = await app.inject({ method: "PATCH", url: "/api/admin/agent-marketplace/item-1", headers: { authorization: "Bearer session" }, payload: { status: "published" } });
    expect(response.statusCode).toBe(200);
    expect(query.mock.calls.some(([sql]) => sql.includes("insert into admin_audit_logs"))).toBe(true);
    await app.close();
  });

  it("only treats published catalog listings as available", () => {
    expect(isMarketplaceItemAvailable("published")).toBe(true);
    expect(isMarketplaceItemAvailable("hidden")).toBe(false);
    expect(isMarketplaceItemAvailable("draft")).toBe(false);
    expect(isMarketplaceItemAvailable(null)).toBe(false);
    expect(isMarketplaceItemAvailable(undefined)).toBe(false);
  });

  it("flags installed entries whose catalog listing was taken down", async () => {
    const installs = [
      { item_id: "item-hidden", target: "workspace", installed_version: "1.0.0", status: "installed", metadata: {}, installed_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", kind: "plugin", name: "Brand Voice", slug: "brand-voice", item_status: "hidden" },
      { item_id: "item-live", target: "desktop", installed_version: "0.6.2", status: "installed", metadata: { localServerName: "Playwright" }, installed_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-03T00:00:00Z", kind: "mcp", name: "Playwright", slug: "playwright", item_status: "published" },
    ];
    const { app } = buildApi({ installs });
    const response = await app.inject({ method: "GET", url: "/api/agent-marketplace/installs", headers: { authorization: "Bearer session" } });
    expect(response.statusCode).toBe(200);
    const data = response.json().data as Array<Record<string, unknown>>;
    expect(data.map((item) => [item.item_id, item.available])).toEqual([["item-hidden", false], ["item-live", true]]);
    const [first] = data;
    // Old clients keep reading the response: the internal join column never leaks, and every
    // pre-existing field survives the projection.
    expect(first?.item_status).toBeUndefined();
    expect(first).toMatchObject({ item_id: "item-hidden", target: "workspace", installed_version: "1.0.0", kind: "plugin", name: "Brand Voice", slug: "brand-voice", status: "installed" });
    await app.close();
  });

  it("persists the enabled state and applies it to a declarative plugin install", async () => {
    const { app, query } = buildApi({ itemKind: "plugin", installMetadata: { module: "declarative-agent-guidance" } });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/agent-marketplace/item-1/install",
      headers: { authorization: "Bearer session" },
      payload: { enabled: false },
    });
    expect(response.statusCode).toBe(200);
    expect(query.mock.calls.some(([sql, params]) => sql.includes("update agent_marketplace_installs") && String(params?.[0]).includes('"enabled":false'))).toBe(true);
    await app.close();
  });
});
