import { afterEach, expect, it, vi } from "vitest";
import { startQueueRunner } from "./queue-runner.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

it("polls independent queues without waiting for an idle queue", async () => {
  const idle = deferred<number[]>();
  const completed = deferred<void>();
  const execute = vi.fn(async () => { completed.resolve(); });
  const runner = startQueueRunner({
    queues: [{ name: "images", concurrency: 1 }, { name: "captures", concurrency: 1 }],
    poll: vi.fn(async name => name === "images" ? idle.promise : [1]),
    execute, onError: vi.fn(),
  });
  await completed.promise;
  const stopped = runner.stop();
  idle.resolve([]);
  await stopped;
  expect(execute).toHaveBeenCalledWith("captures", 1);
});

it("waits for pending polls and active work, without executing late messages", async () => {
  const active = deferred<void>();
  const late = deferred<number[]>();
  const poll = vi.fn().mockResolvedValueOnce([1]).mockImplementation(() => late.promise);
  const execute = vi.fn(() => active.promise);
  const runner = startQueueRunner({ queues: [{ name: "video", concurrency: 2 }], poll, execute, onError: vi.fn() });
  await vi.waitFor(() => expect(poll).toHaveBeenCalledTimes(2));
  let closed = false;
  const stopping = runner.stop().then(() => { closed = true; });
  late.resolve([2]);
  await Promise.resolve();
  expect(closed).toBe(false);
  active.resolve();
  await stopping;
  expect(execute).toHaveBeenCalledTimes(1);
});

it("backs off query failures and interrupts the delay on stop", async () => {
  vi.useFakeTimers();
  const poll = vi.fn().mockRejectedValue(new Error("database unavailable"));
  const report = vi.fn();
  const runner = startQueueRunner({ queues: [{ name: "video", concurrency: 1 }], poll, execute: vi.fn(), onError: report });
  await vi.advanceTimersByTimeAsync(999);
  expect(poll).toHaveBeenCalledTimes(1);
  await runner.stop();
  expect(report).toHaveBeenCalledTimes(1);
});
