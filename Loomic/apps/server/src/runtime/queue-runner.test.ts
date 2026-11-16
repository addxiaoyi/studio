import { afterEach, expect, it, vi } from "vitest";
import { startQueueRunner } from "./queue-runner.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

it("polls independent queues without waiting for an idle queue", async () => {
  const idle = deferred<number[]>();
  const completed = deferred<void>();
  const execute = vi.fn(async () => {
    completed.resolve();
  });
  const runner = startQueueRunner({
    queues: [
      { name: "images", concurrency: 1 },
      { name: "captures", concurrency: 1 },
    ],
    poll: vi.fn(async (name) => (name === "images" ? idle.promise : [1])),
    execute,
    release: vi.fn(async () => {}),
    onError: vi.fn(),
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
  const poll = vi
    .fn()
    .mockResolvedValueOnce([1])
    .mockImplementation(() => late.promise);
  const execute = vi.fn(() => active.promise);
  const release = vi.fn(async () => {});
  const runner = startQueueRunner({
    queues: [{ name: "video", concurrency: 2 }],
    poll,
    execute,
    release,
    onError: vi.fn(),
  });
  await vi.waitFor(() => expect(poll).toHaveBeenCalledTimes(2));
  let closed = false;
  const stopping = runner.stop().then(() => {
    closed = true;
  });
  late.resolve([2]);
  await Promise.resolve();
  expect(closed).toBe(false);
  active.resolve();
  await stopping;
  expect(execute).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledWith("video", 2);
});

it("releases messages claimed by a poll that finishes after shutdown", async () => {
  const late = deferred<number[]>();
  const release = vi.fn(async () => {});
  const execute = vi.fn(async () => {});
  const poll = vi.fn(() => late.promise);
  const runner = startQueueRunner({
    queues: [{ name: "video", concurrency: 1 }],
    poll,
    execute,
    release,
    onError: vi.fn(),
  });
  await vi.waitFor(() => expect(poll).toHaveBeenCalledOnce());

  const stopping = runner.stop();
  late.resolve([42]);
  await stopping;

  expect(release).toHaveBeenCalledWith("video", 42);
  expect(execute).not.toHaveBeenCalled();
});

it("reports queue lease release failures during shutdown", async () => {
  const late = deferred<number[]>();
  const error = new Error("queue connection closed");
  const onError = vi.fn();
  const runner = startQueueRunner({
    queues: [{ name: "video", concurrency: 1 }],
    poll: vi.fn(() => late.promise),
    execute: vi.fn(async () => {}),
    release: vi.fn().mockRejectedValue(error),
    onError,
  });
  await vi.waitFor(() => expect(runner.activeCount).toBe(0));

  const stopping = runner.stop();
  late.resolve([7]);
  await expect(stopping).rejects.toThrow("unexecuted queue leases");

  expect(onError).toHaveBeenCalledWith("video", error);
});

it("drains active work and tries every late lease before rejecting an incomplete release", async () => {
  const active = deferred<void>();
  const late = deferred<number[]>();
  const poll = vi
    .fn()
    .mockResolvedValueOnce([1])
    .mockImplementation(() => late.promise);
  const release = vi.fn(async (_queue: string, message: number) => {
    if (message === 2) throw new Error("lease release failed");
  });
  const runner = startQueueRunner({
    queues: [{ name: "video", concurrency: 2 }],
    poll,
    execute: vi.fn(() => active.promise),
    release,
    onError: vi.fn(),
  });
  await vi.waitFor(() => expect(poll).toHaveBeenCalledTimes(2));
  let settled = false;
  const stopping = runner.stop();
  const rejection = expect(stopping)
    .rejects.toThrow("unexecuted queue leases")
    .then(() => {
      settled = true;
    });
  late.resolve([2, 3]);
  await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(2));
  expect(settled).toBe(false);
  active.resolve();
  await rejection;
  expect(release).toHaveBeenCalledWith("video", 3);
});

it("backs off query failures and interrupts the delay on stop", async () => {
  vi.useFakeTimers();
  const poll = vi.fn().mockRejectedValue(new Error("database unavailable"));
  const report = vi.fn();
  const runner = startQueueRunner({
    queues: [{ name: "video", concurrency: 1 }],
    poll,
    execute: vi.fn(),
    release: vi.fn(async () => {}),
    onError: report,
  });
  await vi.advanceTimersByTimeAsync(999);
  expect(poll).toHaveBeenCalledTimes(1);
  await runner.stop();
  expect(report).toHaveBeenCalledTimes(1);
});

it("does not forget an unpersisted execution failure once the task leaves the active set", async () => {
  const idle = deferred<number[]>();
  const failure = new Error("completion state could not be saved");
  const report = vi.fn();
  const runner = startQueueRunner({
    queues: [{ name: "video", concurrency: 1 }],
    poll: vi
      .fn()
      .mockResolvedValueOnce([1])
      .mockImplementation(() => idle.promise),
    execute: vi.fn().mockRejectedValue(failure),
    release: vi.fn(),
    onError: report,
  });
  await vi.waitFor(() => expect(report).toHaveBeenCalledWith("video", failure));
  expect(runner.activeCount).toBe(0);
  const stopping = runner.stop();
  const rejection = expect(stopping).rejects.toThrow("queue executions");
  idle.resolve([]);
  await rejection;
  await expect(runner.stop()).rejects.toThrow("queue executions");
});

it("waits for other executions before reporting an unsafe drain", async () => {
  const slow = deferred<void>();
  const idle = deferred<number[]>();
  const report = vi.fn();
  const runner = startQueueRunner({
    queues: [{ name: "video", concurrency: 2 }],
    poll: vi
      .fn()
      .mockResolvedValueOnce([1, 2])
      .mockImplementation(() => idle.promise),
    execute: vi.fn(async (_queue, id) => {
      if (id === 1) throw new Error("completion state could not be saved");
      await slow.promise;
    }),
    release: vi.fn(),
    onError: report,
  });
  await vi.waitFor(() => expect(report).toHaveBeenCalledOnce());
  let settled = false;
  const rejection = expect(runner.stop())
    .rejects.toThrow("queue executions")
    .then(() => {
      settled = true;
    });
  idle.resolve([]);
  await Promise.resolve();
  expect(settled).toBe(false);
  slow.resolve();
  await rejection;
});
