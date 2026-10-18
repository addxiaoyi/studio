// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchJob, fetchJobs } = vi.hoisted(() => ({
  fetchJob: vi.fn(),
  fetchJobs: vi.fn().mockResolvedValue({ jobs: [] }),
}));

vi.mock("../src/lib/server-api", () => ({ fetchJob, fetchJobs }));

import { useJobFallbackPolling } from "../src/hooks/use-job-fallback-polling";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function setup(token: string | undefined = "session-token") {
  const onJobSucceeded = vi.fn();
  const accessTokenRef: { current: string | undefined } = { current: token };
  const hook = renderHook(() => useJobFallbackPolling({ onJobSucceeded, accessTokenRef }));
  return { ...hook, onJobSucceeded, accessTokenRef };
}

const timedOutEvent = (jobId: string, jobType = "video_generation") => ({
  type: "tool.completed",
  output: { error: "Video is still being generated", jobId, jobType },
} as never);

describe("useJobFallbackPolling", () => {
  it("polls a timed-out job and notifies once after success", async () => {
    vi.useFakeTimers();
    fetchJob.mockResolvedValue({ job: { status: "succeeded", result: { asset_id: "asset-1" }, job_type: "video_generation" } });
    const { result, onJobSucceeded } = setup();

    act(() => result.current.checkForTimedOutJobs(timedOutEvent("job-1")));
    act(() => result.current.checkForTimedOutJobs(timedOutEvent("job-1")));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(fetchJob).toHaveBeenCalledOnce();
    expect(fetchJob).toHaveBeenCalledWith("session-token", "job-1");
    expect(onJobSucceeded).toHaveBeenCalledOnce();
    expect(onJobSucceeded).toHaveBeenCalledWith("job-1", "video_generation");
  });

  it.each(["failed", "dead_letter", "canceled"] as const)("stops polling at terminal status %s", async (status) => {
    vi.useFakeTimers();
    fetchJob.mockResolvedValue({ job: { status, result: null, job_type: "image_generation" } });
    const { result, onJobSucceeded } = setup();

    act(() => result.current.checkForTimedOutJobs(timedOutEvent("job-terminal", "image_generation")));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    expect(fetchJob).toHaveBeenCalledOnce();
    expect(onJobSucceeded).not.toHaveBeenCalled();
  });

  it("does not call the API after logout or after the maximum polling duration", async () => {
    vi.useFakeTimers();
    const { result, accessTokenRef } = setup();
    accessTokenRef.current = undefined;
    act(() => result.current.checkForTimedOutJobs(timedOutEvent("job-logout")));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchJob).not.toHaveBeenCalled();

    accessTokenRef.current = "session-token";
    fetchJob.mockResolvedValue({ job: { status: "running", result: null, job_type: "video_generation" } });
    act(() => result.current.checkForTimedOutJobs(timedOutEvent("job-expired")));
    vi.setSystemTime(Date.now() + 20 * 60 * 1000 + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchJob).not.toHaveBeenCalled();
  });
});
