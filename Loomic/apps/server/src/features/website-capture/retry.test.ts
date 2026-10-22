import { describe, expect, it, vi } from "vitest";

import { claimWebsiteCaptureRetry } from "./retry.js";

describe("website capture retry claim", () => {
  it("atomically claims only failed tasks for the requesting workspace member", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "task-1", background_job_id: "job-1", mode: "isolated", status: "queued" }] });
    const db = { query } as never;

    const result = await claimWebsiteCaptureRetry(db, "task-1", "workspace-1", "user-1");

    expect(result).toEqual({ id: "task-1", background_job_id: "job-1", mode: "isolated", status: "queued" });
    expect(query.mock.calls[0]?.[0]).toContain("status='failed'");
    expect(query.mock.calls[0]?.[1]).toEqual(["task-1", "workspace-1", "user-1"]);
  });

  it("returns no claim to concurrent duplicate retries", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const result = await claimWebsiteCaptureRetry({ query } as never, "task-1", "workspace-1", "user-1");

    expect(result).toBeNull();
  });
});
