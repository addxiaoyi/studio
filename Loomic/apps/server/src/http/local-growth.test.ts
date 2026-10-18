import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { registerLocalGrowthRoutes } from "./local-growth.js";

const overview = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("../local-db/home-overview-service.js", () => ({
  loadHomeOverview: overview.load,
}));

vi.mock("../local-db/admin-overview-charts.js", () => ({
  loadAdminOverviewCharts: vi.fn(),
}));

describe("GET /api/home/overview", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    overview.load.mockReset();
  });

  function createApp(authenticate = vi.fn().mockResolvedValue({ id: "user-1" })) {
    const app = Fastify();
    apps.push(app);
    registerLocalGrowthRoutes(app, {
      db: { query: vi.fn() } as unknown as Pool,
      auth: { authenticate },
      viewerService: {
        ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }),
      } as never,
    });
    return app;
  }

  it("returns the requested authenticated workspace overview", async () => {
    const data = {
      periodDays: 14,
      activeProjects: 3,
      monthlyGenerations: 7,
      teamMembers: 1,
      daily: [],
    };
    overview.load.mockResolvedValue(data);
    const app = createApp();

    const response = await app.inject({ method: "GET", url: "/api/home/overview?days=14" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data });
    expect(overview.load).toHaveBeenCalledWith(expect.anything(), "workspace-1", 14);
  });

  it("rejects unsupported overview ranges", async () => {
    const app = createApp();

    const response = await app.inject({ method: "GET", url: "/api/home/overview?days=21" });

    expect(response.statusCode).toBe(400);
    expect(overview.load).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    const app = createApp(vi.fn().mockResolvedValue(null));

    const response = await app.inject({ method: "GET", url: "/api/home/overview?days=14" });

    expect(response.statusCode).toBe(401);
    expect(overview.load).not.toHaveBeenCalled();
  });
});
