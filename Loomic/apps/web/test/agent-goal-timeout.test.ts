// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createAgentGoal, fetchAgentGoals } from "../src/lib/server-api";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function stalledFetch() {
  let signal: AbortSignal | undefined;
  const fetch = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => {
    signal = options.signal;
    signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  vi.stubGlobal("fetch", fetch);
  return { fetch, signal: () => signal };
}

it("keeps model planning alive past the normal API deadline with a finite upper bound", async () => {
  vi.useFakeTimers();
  const request = stalledFetch();
  const pending = createAgentGoal("test", { goal: "录制网页", idempotencyKey: "test" });
  const assertion = expect(pending).rejects.toMatchObject({ kind: "timeout" });
  await vi.advanceTimersByTimeAsync(30_001);
  expect(request.signal()?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(99_999);
  await assertion;
  expect(request.signal()?.aborted).toBe(true);
  expect(request.fetch).toHaveBeenCalledTimes(1);
});

it("keeps the ordinary list deadline at thirty seconds", async () => {
  vi.useFakeTimers();
  const request = stalledFetch();
  const assertion = expect(fetchAgentGoals("test")).rejects.toMatchObject({ kind: "timeout" });
  await vi.advanceTimersByTimeAsync(30_000);
  await assertion;
  expect(request.signal()?.aborted).toBe(true);
});
