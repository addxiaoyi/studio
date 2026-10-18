import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { createLocalJobService } from "./job-service.js";

const user = { id: "user-1" } as any;

function jobRow() {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    workspace_id: "workspace-1",
    project_id: null,
    canvas_id: null,
    session_id: null,
    thread_id: null,
    idempotency_key: "idem-1",
    queue_name: "image_generation_jobs",
    job_type: "image_generation",
    status: "queued",
    payload: { prompt: "same" },
    result: null,
    error_code: null,
    error_message: null,
    progress: 0,
    stage: null,
    attempt_count: 0,
    max_attempts: 3,
    created_by: "user-1",
    created_at: now,
    updated_at: now,
    started_at: null,
    completed_at: null,
    failed_at: null,
    canceled_at: null,
  };
}

describe("local job idempotency", () => {
  it("notifies the owner when a generation job becomes ready", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ workspace_id: "workspace-1", created_by: "user-1", job_type: "image_generation" }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createLocalJobService({ query } as unknown as Pool);

    await service.markSucceeded("job-1", { asset_id: "asset-1" });

    expect(query.mock.calls[1]?.[1]?.[2]).toBe("asset_ready");
    expect(query.mock.calls[1]?.[1]?.[0]).toBe("workspace-1");
    expect(String(query.mock.calls[1]?.[1]?.[5])).toContain("asset-1");
  });

  it("requeues a sync-failed job from its Provider checkpoint without creating a new job", async () => {
    const queue = { send: vi.fn().mockResolvedValue(1) } as any;
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "job-1", job_type: "video_generation", workspace_id: "workspace-1", queue_name: "video_generation_jobs" }] });
    const service = createLocalJobService({ query } as unknown as Pool, queue);

    await expect(service.retryProviderCheckpoint("job-1")).resolves.toBe(true);

    expect(String(query.mock.calls[0]?.[0])).toContain("provider_result is not null");
    expect(queue.send).toHaveBeenCalledOnce();
    expect(queue.send).toHaveBeenCalledWith("video_generation_jobs", expect.objectContaining({ job_id: "job-1" }));
  });

  it("enqueues a newly created job and does not enqueue a reused job", async () => {
    const queue = { send: vi.fn().mockResolvedValue(1) } as any;
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [jobRow()] })
      .mockResolvedValueOnce({ rows: [jobRow()] });
    const service = createLocalJobService({ query } as unknown as Pool, queue);

    const created = await service.createJob(user, {
      workspaceId: "workspace-1",
      idempotencyKey: "idem-1",
      jobType: "image_generation",
      payload: { prompt: "same" },
    });

    expect(created).toMatchObject({ id: "job-1", reused: false, status: "queued" });
    expect(queue.send).toHaveBeenCalledWith("image_generation_jobs", expect.objectContaining({ job_id: "job-1" }));
  });

  it("uses the database conflict guard and returns the existing job", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [jobRow()] });
    const service = createLocalJobService({ query } as unknown as Pool);

    const job = await service.createJob(user, {
      workspaceId: "workspace-1",
      idempotencyKey: "idem-1",
      jobType: "image_generation",
      payload: { prompt: "same" },
    });

    expect(job).toMatchObject({ id: "job-1", reused: true });
    const insertSql = query.mock.calls[0]?.[0];
    expect(String(insertSql ?? "")).toContain("on conflict (created_by, idempotency_key)");
  });

  it("claims only queued or failed jobs in one atomic update", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ attempt_count: 1, max_attempts: 3 }] });
    const service = createLocalJobService({ query } as unknown as Pool);

    const claim = await service.claimJob("job-1");

    expect(claim).toEqual({ attempt_count: 1, max_attempts: 3 });
    expect(String(query.mock.calls[0]?.[0] ?? "")).toContain("status in ('queued','failed')");
    expect(String(query.mock.calls[0]?.[0] ?? "")).toContain("returning attempt_count, max_attempts");
  });

  it("requeues a canceled idempotent job for a failed approval retry", async () => {
    const canceled = { ...jobRow(), status: "canceled", canceled_at: new Date().toISOString() };
    const queue = { send: vi.fn().mockResolvedValue(1) } as any;
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [canceled] })
      .mockResolvedValueOnce({ rows: [{ ...canceled, status: "queued", canceled_at: null }] });
    const service = createLocalJobService({ query } as unknown as Pool, queue);

    const job = await service.createJob(user, {
      workspaceId: "workspace-1",
      idempotencyKey: "idem-1",
      jobType: "image_generation",
      payload: { prompt: "same" },
    });

    expect(job).toMatchObject({ id: "job-1", reused: true, reactivated: true, status: "queued" });
    expect(queue.send).toHaveBeenCalledTimes(1);
  });
});
