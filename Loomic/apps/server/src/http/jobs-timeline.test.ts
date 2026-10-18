import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerJobRoutes } from "./jobs.js";

const user = { id: "user-1", accessToken: "token", email: "user@example.com", userMetadata: {} };

function buildJob(status: "queued" | "running" | "succeeded" | "failed") {
  return {
    id: "job-1", workspace_id: "workspace-1", project_id: "project-1", canvas_id: "canvas-1", session_id: "session-1", thread_id: "thread-1", queue_name: "video_generation_jobs", job_type: "video_generation", status,
    payload: { model: "minimax-h3", providerTaskId: "provider-task-1" },
    result: status === "succeeded" ? { providerTaskId: "provider-task-1", asset_id: "asset-1", video_url: "https://cdn.example/video.mp4" } : null,
    error_code: status === "failed" ? "provider_error" : null, error_message: status === "failed" ? "Provider failed" : null,
    progress: status === "succeeded" ? 100 : 42, stage: status === "succeeded" ? "canvas_writeback" : "provider_polling", attempt_count: 1, max_attempts: 3, created_by: "user-1", created_at: "2026-10-12T00:00:00.000Z", updated_at: "2026-10-12T00:01:00.000Z", started_at: "2026-10-12T00:00:01.000Z", completed_at: status === "succeeded" ? "2026-10-12T00:01:00.000Z" : null, failed_at: status === "failed" ? "2026-10-12T00:01:00.000Z" : null, canceled_at: null,
  } as const;
}

function buildApp(status: "queued" | "running" | "succeeded" | "failed") {
  const app = Fastify();
  const db = { query: vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes("generation_approvals")) return { rows: [{ id: "approval-1", status: "approved", approved_at: "2026-10-12T00:00:00.100Z", consumed_at: "2026-10-12T00:00:00.200Z", expires_at: "2026-10-12T00:10:00.000Z" }] };
    if (sql.includes("from asset_objects")) return { rows: status === "succeeded" ? [{ id: "asset-1", created_at: "2026-10-12T00:00:30.000Z" }] : [] };
    if (sql.includes("from canvases")) return { rows: status === "succeeded" ? [{ id: "canvas-1" }] : [] };
    throw new Error(`Unexpected query: ${sql}`);
  }) };
  const jobService = { getJob: vi.fn().mockResolvedValue(buildJob(status)) };
  void registerJobRoutes(app, { auth: { authenticate: vi.fn().mockResolvedValue(user) }, jobService: jobService as never, viewerService: {} as never, localDb: db as never });
  return { app, db, jobService };
}

describe("job timeline route", () => {
  it("reports approval, Provider task, asset, and Canvas writeback completion", async () => {
    const { app, db, jobService } = buildApp("succeeded"); await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/jobs/job-1/timeline" });
    const body = response.json() as { jobId: string; events: Array<{ key: string; status: string; id?: string }> };
    expect(response.statusCode).toBe(200); expect(body.jobId).toBe("job-1");
    expect(body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "approval", status: "done", id: "approval-1" }), expect.objectContaining({ key: "provider", status: "done", id: "provider-task-1" }), expect.objectContaining({ key: "asset", status: "done", id: "asset-1" }), expect.objectContaining({ key: "canvas", status: "done", id: "canvas-1" }),
    ]));
    expect(jobService.getJob).toHaveBeenCalledWith(user, "job-1"); expect(db.query).toHaveBeenCalledTimes(3); await app.close();
  });

  it("keeps asset and Canvas stages pending while the Provider job is still running", async () => {
    const { app } = buildApp("running"); await app.ready(); const response = await app.inject({ method: "GET", url: "/api/jobs/job-1/timeline" }); const events = (response.json() as { events: Array<{ key: string; status: string }> }).events;
    expect(response.statusCode).toBe(200); expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ key: "provider", status: "active" }), expect.objectContaining({ key: "asset", status: "pending" }), expect.objectContaining({ key: "canvas", status: "pending" })])); await app.close();
  });

  it("marks the Provider stage failed and keeps the failure visible", async () => {
    const { app } = buildApp("failed"); await app.ready(); const response = await app.inject({ method: "GET", url: "/api/jobs/job-1/timeline" }); const events = (response.json() as { events: Array<{ key: string; status: string }> }).events;
    expect(response.statusCode).toBe(200); expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ key: "provider", status: "failed" }), expect.objectContaining({ key: "asset", status: "failed" })])); await app.close();
  });
});
