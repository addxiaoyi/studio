import { describe, expect, it, vi } from "vitest";

import { createLocalJobQueue } from "./local-job-queue.js";

describe("local job queue", () => {
  it("leaves atomic job claiming to the worker", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rows: [{
            id: "job-1",
            job_type: "image_generation",
            payload: { prompt: "test" },
            workspace_id: "workspace-1",
            canvas_id: null,
            session_id: null,
            attempt_count: 0,
            max_attempts: 3,
          }],
        })
        .mockResolvedValueOnce(undefined),
      release: vi.fn(),
    };
    const db = { connect: vi.fn().mockResolvedValue(client) };
    const queue = createLocalJobQueue(db as any);

    const [message] = await queue.read("image_generation_jobs", 120, 1);

    expect(message?.message).not.toHaveProperty("local_claimed");
    expect(message?.message).toMatchObject({ job_id: "job-1", attempt_count: 0 });
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(String(client.query.mock.calls[1]?.[0])).not.toContain("status = 'running'");
  });
});
