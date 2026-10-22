import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerWebsiteCaptureRoutes } from "./website-capture.js";

const user = { id: "user-1", email: "user@example.test" };
const workspaceId = "workspace-current";

function captureTask(status: string, backgroundJobId: string | null) {
  return {
    id: "task-1",
    background_job_id: backgroundJobId,
    status,
    mode: "isolated",
    start_url: "https://8.8.8.8/",
    progress: 0,
    stage: status,
    result: null,
    error_message: null,
    created_at: new Date("2026-10-22T00:00:00.000Z"),
    updated_at: new Date("2026-10-22T00:00:00.000Z"),
    follow_external: false,
    assistant_connection_id: null,
  };
}

function buildApp(query: ReturnType<typeof vi.fn>) {
  const jobService = { createJob: vi.fn().mockResolvedValue({ id: "job-1", reused: false }) };
  const app = Fastify();
  registerWebsiteCaptureRoutes(app, {
    db: { query } as never,
    auth: { authenticate: vi.fn().mockResolvedValue(user) } as never,
    viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: workspaceId } }) } as never,
    jobService: jobService as never,
    assistantHub: {} as never,
  });
  return { app, jobService };
}

const payload = {
  url: "https://8.8.8.8/",
  mode: "isolated",
  pageLimit: 2,
  recordVideo: false,
  followExternal: false,
  idempotencyKey: "request-1",
};

describe("website capture creation idempotency scope", () => {
  it("scopes task conflicts and fallback lookup to the current workspace", async () => {
    const currentTask = captureTask("running", "job-1");
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("insert into website_capture_tasks")) return { rows: [] };
      if (sql.includes("from website_capture_tasks where workspace_id=$1 and created_by=$2 and idempotency_key=$3")) {
        expect(values).toEqual([workspaceId, user.id, payload.idempotencyKey]);
        return { rows: [currentTask] };
      }
      if (sql.includes("from website_capture_tasks where id=$1 and workspace_id=$2")) return { rows: [currentTask] };
      return { rows: [] };
    });
    const { app, jobService } = buildApp(query);

    const response = await app.inject({ method: "POST", url: "/api/website-capture", payload });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ reused: true, task: { id: "task-1" }, jobId: "job-1" });
    const insert = query.mock.calls.find(([sql]) => String(sql).includes("insert into website_capture_tasks"));
    expect(insert?.[0]).toContain("on conflict (workspace_id, created_by, idempotency_key)");
    expect(insert?.[1]?.slice(0, 2)).toEqual([workspaceId, user.id]);
    expect(jobService.createJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("namespaces the background job idempotency key by workspace", async () => {
    const insertedTask = captureTask("queued", null);
    const loadedTask = captureTask("queued", "job-1");
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("insert into website_capture_tasks")) return { rows: [insertedTask] };
      if (sql.includes("from website_capture_tasks where id=$1 and workspace_id=$2")) return { rows: [loadedTask] };
      return { rows: [] };
    });
    const { app, jobService } = buildApp(query);

    const response = await app.inject({ method: "POST", url: "/api/website-capture", payload });

    expect(response.statusCode).toBe(202);
    expect(jobService.createJob).toHaveBeenCalledWith(user, expect.objectContaining({
      workspaceId,
      idempotencyKey: `website-capture:${workspaceId}:${payload.idempotencyKey}`,
    }));
    await app.close();
  });
});
