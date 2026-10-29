import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createLocalJobService } from "./job-service.js";

const BIG_INLINE_IMAGE = `data:image/png;base64,${"A".repeat(3_000_000)}`;

function createRow() {
  return {
    id: "job-1",
    workspace_id: "ws-1",
    project_id: null,
    canvas_id: null,
    session_id: null,
    thread_id: null,
    idempotency_key: null,
    queue_name: "image_generation_jobs",
    job_type: "image_generation",
    status: "succeeded",
    payload: { prompt: "a cat", model: "flux", input_images: [BIG_INLINE_IMAGE], input_asset_ids: ["asset-1"] },
    result: { asset_id: "asset-1", url: "https://example.com/a.png" },
    error_code: null,
    error_message: null,
    progress: 100,
    stage: "done",
    attempt_count: 1,
    max_attempts: 3,
    created_by: "user-1",
    created_at: new Date("2026-10-28T00:00:00Z"),
    updated_at: new Date("2026-10-28T00:00:10Z"),
    started_at: null,
    completed_at: null,
    failed_at: null,
    canceled_at: null,
    sync_attempt_count: 0,
    next_sync_at: null,
    sync_error_code: null,
    sync_error_message: null,
  };
}

function createService() {
  const row = createRow();
  const db = { query: async () => ({ rows: [row], rowCount: 1 }) } as unknown as Pool;
  return { service: createLocalJobService(db), row };
}

describe("job list payload trimming", () => {
  it("elides inline base64 reference images from the list response", async () => {
    const { service } = createService();
    const [job] = await service.listJobs({ id: "user-1" } as never, {});
    const payload = job!.payload as Record<string, unknown>;
    const images = payload.input_images as string[];
    expect(images).toHaveLength(1);
    expect(images[0]).toContain("elided");
    expect(images[0]!.length).toBeLessThan(100);
    expect(JSON.stringify(job!.payload).length).toBeLessThan(4096);
  });

  it("keeps the scalar fields the job list UI reads", async () => {
    const { service } = createService();
    const [job] = await service.listJobs({ id: "user-1" } as never, {});
    const payload = job!.payload as Record<string, unknown>;
    expect(payload.prompt).toBe("a cat");
    expect(payload.model).toBe("flux");
    expect(payload.input_asset_ids).toEqual(["asset-1"]);
  });

  it("still returns the full payload from the detail read", async () => {
    const { service } = createService();
    const job = await service.getJob({ id: "user-1" } as never, "job-1");
    const payload = job.payload as Record<string, unknown>;
    expect((payload.input_images as string[])[0]).toBe(BIG_INLINE_IMAGE);
  });
});

describe("job list reads the summary column, not the payload", () => {
  it("selects payload_summary for the list query", async () => {
    const queries: string[] = [];
    const row = createRow();
    const db = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [row], rowCount: 1 };
      },
    } as unknown as Pool;
    const service = createLocalJobService(db);
    await service.listJobs({ id: "user-1" } as never, {});
    expect(queries[0]).toContain("coalesce(payload_summary");
    expect(queries[0]).not.toMatch(/\bstatus, payload,/);
  });

  it("writes an elided summary alongside the payload on create", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const row = createRow();
    const db = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [row], rowCount: 1 };
      },
    } as unknown as Pool;
    const service = createLocalJobService(db);
    await service.createJob({ id: "user-1" } as never, {
      workspaceId: "ws-1",
      jobType: "image_generation",
      payload: { prompt: "a cat", input_images: [BIG_INLINE_IMAGE] },
    } as never);
    const insert = calls.find((c) => c.sql.startsWith("insert into background_jobs"));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("payload_summary");
    const summary = insert!.params.find((p) => typeof p === "string" && p.includes("inline image elided"));
    expect(summary).toBeDefined();
    expect((summary as string).length).toBeLessThan(1024);
  });
});
