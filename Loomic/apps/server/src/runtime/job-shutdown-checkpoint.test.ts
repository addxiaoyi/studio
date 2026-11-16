import { describe, expect, it, vi } from "vitest";
import { ActiveJobTracker, checkpointActiveJobs, JOB_SHUTDOWN_STAGE } from "./job-shutdown-checkpoint.js";

it("retains a job ID until every duplicate delivery has left", () => {
  const active = new ActiveJobTracker();
  active.enter("job-1");
  active.enter("job-1");
  active.enter("");

  active.leave("job-1");
  expect(active.ids()).toEqual(["job-1"]);
  active.leave("job-1");
  active.leave("job-1");
  expect(active.ids()).toEqual([]);
});

describe("job shutdown checkpoint", () => {
  it("writes one resumable stage per active job", async () => {
    const markShutdownRequested = vi.fn().mockResolvedValue(undefined);

    const count = await checkpointActiveJobs(
      { markShutdownRequested },
      ["job-1", "job-1", "", "job-2"],
    );

    expect(count).toBe(2);
    expect(markShutdownRequested).toHaveBeenCalledTimes(2);
    expect(markShutdownRequested.mock.calls).toEqual([
      ["job-1", JOB_SHUTDOWN_STAGE],
      ["job-2", JOB_SHUTDOWN_STAGE],
    ]);
  });

  it("fails shutdown when a checkpoint cannot be written", async () => {
    const error = new Error("database unavailable");

    await expect(
      checkpointActiveJobs(
        { markShutdownRequested: vi.fn().mockRejectedValue(error) },
        ["job-1"],
      ),
    ).rejects.toBe(error);
  });
});
