import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { syncGenerationJob } from "./sync-service.js";

function storage() {
  return { upload: vi.fn(), getPublicUrl: vi.fn(), download: vi.fn() } as never;
}

describe("generation job synchronization", () => {
  it("claims a pending sync once when concurrent workers race", async () => {
    let claimed = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("update background_jobs") && sql.includes("returning id, job_type")) {
        if (claimed) return { rows: [] };
        claimed = true;
        return { rows: [{ id: "job-1", job_type: "video_generation", canvas_id: null, payload: {}, result: { asset_id: "asset-1" }, sync_attempt_count: 0 }] };
      }
      return { rows: [] };
    });
    const db = { query } as unknown as Pool;

    const outcomes = await Promise.all([
      syncGenerationJob(db, storage(), "job-1"),
      syncGenerationJob(db, storage(), "job-1"),
    ]);

    expect(outcomes).toEqual(expect.arrayContaining([{ state: "succeeded" }, { state: "in_progress" }]));
    expect(query.mock.calls.filter(([sql]) => sql.startsWith("update background_jobs") && sql.includes("returning id, job_type"))).toHaveLength(2);
  });

  it("schedules retry after transient Canvas synchronization failure", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("update background_jobs") && sql.includes("returning id, job_type")) {
        return { rows: [{ id: "job-2", job_type: "video_generation", canvas_id: "canvas-1", payload: {}, result: { asset_id: "asset-1", signed_url: "https://assets.test/video.mp4" }, sync_attempt_count: 0 }] };
      }
      return { rows: [] };
    });
    const client = { query: vi.fn().mockRejectedValue(new Error("database temporarily unavailable")), release: vi.fn() };
    const db = { query, connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    const outcome = await syncGenerationJob(db, storage(), "job-2");

    expect(outcome).toMatchObject({ state: "pending", attempt: 1, error: "database temporarily unavailable" });
    expect(query.mock.calls.at(-1)?.[0]).toContain("next_sync_at = $4");
    expect(client.query).toHaveBeenCalledWith("rollback");
  });

  it("retries a Canvas insert without adding the same job twice", async () => {
    let claimCount = 0;
    let canvasContent: Record<string, unknown> = { elements: [] };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("returning id, job_type, canvas_id")) {
        claimCount += 1;
        return { rows: [{ id: "job-3", job_type: "video_generation", canvas_id: "canvas-1", payload: { prompt: "product" }, result: { asset_id: "asset-3", signed_url: "https://assets.test/video.mp4" }, sync_attempt_count: claimCount - 1 }] };
      }
      return { rows: [] };
    });
    let writeAttempts = 0;
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === "select content from canvases where id = $1 for update") return { rows: [{ content: canvasContent }] };
        if (sql.startsWith("update canvases set content")) {
          writeAttempts += 1;
          if (writeAttempts === 1) throw new Error("canvas database temporarily unavailable");
          canvasContent = JSON.parse(String(values?.[0]));
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const db = { query, connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    const first = await syncGenerationJob(db, storage(), "job-3");
    const second = await syncGenerationJob(db, storage(), "job-3", { force: true });

    expect(first).toMatchObject({ state: "pending", attempt: 1 });
    expect(second).toMatchObject({ state: "succeeded", canvasElementId: expect.any(String) });
    expect((canvasContent.elements as Array<{ customData?: { jobId?: string } }>).filter((element) => element.customData?.jobId === "job-3")).toHaveLength(1);
    expect(writeAttempts).toBe(2);
  });
});
