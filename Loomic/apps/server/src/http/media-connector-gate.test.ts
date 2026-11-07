import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { registerJobRoutes } from "./jobs.js";

const apps: ReturnType<typeof Fastify>[] = [];
it("fails closed for try-on when the confirmation service is unavailable", async () => {
  const app = Fastify(); apps.push(app);
  const createJob = vi.fn();
  await registerJobRoutes(app, {
    auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) },
    viewerService: { ensureViewer: vi.fn() } as never,
    jobService: { createJob } as never,
  });
  const response = await app.inject({ method: "POST", url: "/api/jobs/image-generation", payload: { prompt: "try on", purpose: "try-on" } });
  expect(response.statusCode).toBe(503);
  expect(createJob).not.toHaveBeenCalled();
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

it.each(["image-generation", "video-generation"])("blocks disabled %s jobs before creating or charging", async (kind) => {
  const app = Fastify();
  apps.push(app);
  const createJob = vi.fn();
  const deductCredits = vi.fn();
  await registerJobRoutes(app, {
    auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) },
    viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }) } as never,
    localDb: { query: vi.fn().mockResolvedValue({ rows: [{ enabled: false }] }) } as never,
    jobService: { createJob } as never,
    creditService: { deductCredits } as never,
  });

  const response = await app.inject({ method: "POST", url: `/api/jobs/${kind}`, payload: { prompt: "test" } });
  expect(response.statusCode).toBe(403);
  expect(response.json().error.code).toBe("connector_disabled");
  expect(createJob).not.toHaveBeenCalled();
  expect(deductCredits).not.toHaveBeenCalled();
});
