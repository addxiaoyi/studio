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
    cancel_requested_at: null,
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

  it("records a late completion after a cancellation request", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ workspace_id: "workspace-1", created_by: "user-1", job_type: "video_generation" }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createLocalJobService({ query } as unknown as Pool);

    await service.markSucceeded("job-1", {
      asset_id: "asset-1",
    });

    expect(String(query.mock.calls[0]?.[0])).toContain("cancel_requested_at is not null");
    expect(String(query.mock.calls[0]?.[0])).toContain("completed_after_cancel_request");
    expect(String(query.mock.calls[0]?.[0])).toContain("'completed_after_cancel_request'");
  });

  it("preserves the late cancellation outcome while canvas synchronization is pending", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = createLocalJobService({ query } as unknown as Pool);

    await service.markSyncPending("job-1", { asset_id: "asset-1" }, "canvas_sync_failed", "offline");

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("cancel_requested_at is not null");
    expect(sql).toContain("completed_after_cancel_request");
    expect(sql).toContain("then 'cancel_requested' else 'canvas_sync_pending'");
  });

  it("preserves a cancellation request timestamp separately from job status", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...jobRow(), status: "running", cancel_requested_at: new Date().toISOString() }] });
    const service = createLocalJobService({ query } as unknown as Pool);

    await expect(service.cancelJob(user, "job-1")).resolves.toMatchObject({ status: "running", cancel_requested_at: expect.any(String) });
    expect(String(query.mock.calls[1]?.[0])).toContain("cancel_requested_at = coalesce(cancel_requested_at, now())");
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

  it("records a cancellation request without pretending a running task is canceled", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...jobRow(), status: "running", stage: "cancel_requested", error_code: "cancel_requested" }] });
    const service = createLocalJobService({ query } as unknown as Pool);

    await expect(service.cancelJob(user, "job-1")).resolves.toMatchObject({ status: "running", stage: "cancel_requested" });
    expect(String(query.mock.calls[0]?.[0])).toContain("status = 'queued'");
    expect(String(query.mock.calls[1]?.[0])).toContain("stage = 'cancel_requested'");
  });

  it("retains an unknown provider outcome after cancellation and blocks blind retry", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "job-1" }] });
    const service = createLocalJobService({ query } as unknown as Pool);

    await expect(service.markCancellationOutcomeUnknown("job-1", "核验供应商回执")).resolves.toBe(true);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("status='dead_letter'");
    expect(sql).toContain("error_code='cancel_outcome_unknown'");
    expect(sql).toContain("cancel_requested_at is not null");
  });

  it("marks only running jobs with a shutdown checkpoint", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = createLocalJobService({ query } as unknown as Pool);

    await service.markShutdownRequested("job-1", "worker_shutdown_waiting");

    expect(query).toHaveBeenCalledWith(
      "update background_jobs set stage = case when stage = 'cancel_requested' then stage else $1 end, updated_at = now() where id = $2 and status = 'running'",
      ["worker_shutdown_waiting", "job-1"],
    );
  });

  it("preserves a shutdown checkpoint when progress heartbeats arrive", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = createLocalJobService({ query } as unknown as Pool);

    await service.updateProgress("job-1", 48, "rendering");

    expect(String(query.mock.calls[0]?.[0])).toContain(
      "case when stage in ('worker_shutdown_waiting','cancel_requested') then stage else $2 end",
    );
    expect(query.mock.calls[0]?.[1]).toEqual([48, "rendering", "job-1"]);
  });

  it("preserves a canceled idempotent job without requeueing or undoing its refund", async () => {
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

    expect(job).toMatchObject({ id: "job-1", reused: true, status: "canceled" });
    expect(queue.send).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
