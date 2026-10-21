import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerWebsiteCaptureRoutes } from "./website-capture.js";

const user = { id: "user-1", email: "user@example.test" };
const viewer = { workspace: { id: "workspace-1" } };

function taskRow(status = "queued") {
  return {
    id: "task-1",
    background_job_id: "job-1",
    status,
    mode: "isolated",
    start_url: "https://example.com/",
    progress: 0,
    stage: status,
    result: null,
    error_message: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    follow_external: false,
    assistant_connection_id: null,
  };
}

function buildApp(query: ReturnType<typeof vi.fn>, retryJob = vi.fn().mockResolvedValue(undefined), authUser: typeof user | null = user) {
  const app = Fastify();
  registerWebsiteCaptureRoutes(app, {
    db: { query } as never,
    auth: { authenticate: vi.fn().mockResolvedValue(authUser) } as never,
    viewerService: { ensureViewer: vi.fn().mockResolvedValue(viewer) } as never,
    jobService: { retryJob } as never,
    assistantHub: {} as never,
  });
  return { app, retryJob };
}

describe("website capture retry route", () => {
  it("retries a failed task and returns its refreshed state", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("update website_capture_tasks") && sql.includes("status='failed'")) {
        return { rows: [{ id: "task-1", background_job_id: "job-1", mode: "isolated", status: "queued" }] };
      }
      if (sql.includes("select id, background_job_id, status, mode, start_url")) return { rows: [taskRow()] };
      return { rows: [] };
    });
    const { app, retryJob } = buildApp(query);
    const response = await app.inject({ method: "POST", url: "/api/website-capture/task-1/retry" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ reused: false, task: { id: "task-1", status: "queued" } });
    expect(retryJob).toHaveBeenCalledWith(user, "job-1");
    await app.close();
  });

  it("reuses an already claimed retry instead of scheduling it twice", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("update website_capture_tasks") && sql.includes("status='failed'")) return { rows: [] };
      if (sql.includes("select id,background_job_id,status,mode")) return { rows: [{ id: "task-1", background_job_id: "job-1", status: "queued", mode: "isolated" }] };
      if (sql.includes("select status from background_jobs")) return { rows: [{ status: "queued" }] };
      if (sql.includes("select id, background_job_id, status, mode, start_url")) return { rows: [taskRow()] };
      return { rows: [] };
    });
    const { app, retryJob } = buildApp(query);
    const response = await app.inject({ method: "POST", url: "/api/website-capture/task-1/retry" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.reused).toBe(true);
    expect(retryJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("restores failed status when retry scheduling fails", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("update website_capture_tasks") && sql.includes("status='failed'")) {
        return { rows: [{ id: "task-1", background_job_id: "job-1", mode: "isolated", status: "queued" }] };
      }
      return { rows: [] };
    });
    const { app } = buildApp(query, vi.fn().mockRejectedValue(new Error("queue unavailable")));
    const response = await app.inject({ method: "POST", url: "/api/website-capture/task-1/retry" });

    expect(response.statusCode).toBe(500);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("set status='failed'"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("'retry_failed'"))).toBe(true);
    await app.close();
  });

  it("requires authentication before querying task state", async () => {
    const query = vi.fn();
    const { app } = buildApp(query, vi.fn(), null);
    const response = await app.inject({ method: "POST", url: "/api/website-capture/task-1/retry" });

    expect(response.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });
});
