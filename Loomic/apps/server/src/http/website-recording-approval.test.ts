import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerWebsiteCaptureRoutes } from "./website-capture.js";

const approvalId = "123e4567-e89b-42d3-a456-426614174000";

function setup(accepted: boolean) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("update website_recording_approvals a set status=$4")) return { rows: accepted ? [{ id: approvalId }] : [] };
    if (sql.includes("join website_recording_approvals a on")) return { rows: [{ id: "task-1", status: "queued", mode: "isolated", session_id: null, background_job_id: null }] };
    if (sql.includes("from website_capture_tasks where id=$1 and workspace_id=$2")) return { rows: [{ id: "task-1", status: "canceled", mode: "isolated", start_url: "https://example.com/", progress: 0, stage: "canceled", result: null, error_message: null, created_at: new Date(), updated_at: new Date() }] };
    return { rows: [] };
  });
  const createJob = vi.fn();
  const app = Fastify();
  registerWebsiteCaptureRoutes(app, {
    db: { query, connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) } as never,
    auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) } as never,
    viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }) } as never,
    jobService: { createJob } as never,
    assistantHub: {} as never,
  });
  return { app, query, createJob };
}

describe("recording approval endpoint", () => {
  it("rejects without creating a job", async () => {
    const { app, query, createJob } = setup(true);
    const response = await app.inject({ method: "POST", url: "/api/website-capture/task-1/recording-approval/reject", payload: { approvalId } });
    expect(response.statusCode).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("set status='canceled'"), ["task-1"]);
    expect(createJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not dispatch an expired or invalid approval", async () => {
    const { app, createJob } = setup(false);
    const response = await app.inject({ method: "POST", url: "/api/website-capture/task-1/recording-approval/approve", payload: { approvalId } });
    expect(response.statusCode).toBe(409);
    expect(createJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires a fresh approval when retrying a failed recording", async () => {
    const { app, query, createJob } = setup(true);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("for update") && sql.includes("from website_capture_tasks where id=$1")) return { rows: [{ id: "task-1" }] };
      if (sql.includes("update website_capture_tasks") && sql.includes("returning id,background_job_id,status,mode,record_video")) {
        return { rows: [{ id: "task-1", status: "queued", mode: "isolated", record_video: true, background_job_id: null }] };
      }
      if (sql.includes("insert into website_recording_approvals")) return { rows: [{ id: approvalId, status: "pending", action: {}, expires_at: new Date() }] };
      if (sql.includes("from website_capture_tasks where id=$1 and workspace_id=$2")) return { rows: [{ id: "task-1", status: "queued", mode: "isolated", start_url: "https://example.com/", progress: 0, stage: "waiting_recording_approval", result: null, error_message: null, created_at: new Date(), updated_at: new Date() }] };
      return { rows: [] };
    });
    const response = await app.inject({ method: "POST", url: "/api/website-capture/task-1/retry" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.task.stage).toBe("waiting_recording_approval");
    expect(createJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not renew approval while an existing recording job is linked", async () => {
    const { app, query, createJob } = setup(true);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("select id,background_job_id,status,mode,record_video")) {
        return { rows: [{ id: "task-1", status: "queued", mode: "isolated", record_video: true, background_job_id: "job-1" }] };
      }
      return { rows: [] };
    });
    const response = await app.inject({ method: "POST", url: "/api/website-capture/task-1/retry" });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("recording_job_active");
    expect(query.mock.calls.some(([sql]) => sql.includes("insert into website_recording_approvals"))).toBe(false);
    expect(createJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("renews an expired approval when no recording job is linked", async () => {
    const { app, query, createJob } = setup(true);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("for update") && sql.includes("from website_capture_tasks where id=$1")) return { rows: [{ id: "task-1" }] };
      if (sql.includes("select id,background_job_id,status,mode,record_video")) return { rows: [{ id: "task-1", status: "queued", mode: "isolated", record_video: true, background_job_id: null }] };
      if (sql.includes("insert into website_recording_approvals")) return { rows: [{ id: approvalId, status: "pending", action: {}, expires_at: new Date() }] };
      if (sql.includes("from website_capture_tasks where id=$1 and workspace_id=$2")) return { rows: [{ id: "task-1", status: "queued", mode: "isolated", start_url: "https://example.com/", progress: 0, stage: "waiting_recording_approval", result: null, error_message: null, created_at: new Date(), updated_at: new Date() }] };
      return { rows: [] };
    });
    const response = await app.inject({ method: "POST", url: "/api/website-capture/task-1/retry" });
    expect(response.statusCode).toBe(200);
    expect(query.mock.calls.some(([sql]) => sql.includes("insert into website_recording_approvals"))).toBe(true);
    expect(createJob).not.toHaveBeenCalled();
    await app.close();
  });
});
