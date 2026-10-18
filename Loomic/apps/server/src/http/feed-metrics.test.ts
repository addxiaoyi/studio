import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerFeedOperationRoutes } from "./feed-operations.js";

const metricInput = {
  packageId: "11111111-1111-4111-8111-111111111111",
  variantId: null,
  platform: "douyin",
  accountAlias: "主账号",
  postUrl: "https://example.com/post/1",
  publishedAt: "2026-09-13T00:00:00.000Z",
};

describe("feed metrics HTTP routes", () => {
  it("rejects a metric when its package is outside the workspace", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const app = Fastify();
    registerFeedOperationRoutes(app, {
      auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) },
      db,
      viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }) },
    } as never);

    const response = await app.inject({ method: "POST", url: "/api/feed/metrics", payload: metricInput });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("package_not_found");
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
