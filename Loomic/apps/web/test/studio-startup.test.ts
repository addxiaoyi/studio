import { afterEach, expect, it, vi } from "vitest";
import { watchStudioStartup } from "../src/lib/studio-startup";

afterEach(() => vi.useRealTimers());

it("times out stalled compilation even when the same stage is reported repeatedly", () => {
  vi.useFakeTimers();
  const timeout = vi.fn();
  const watch = watchStudioStartup(vi.fn(), timeout);
  watch.stage({ phase: "compile" });
  vi.advanceTimersByTime(30_000);
  watch.stage({ phase: "compile" });
  vi.advanceTimersByTime(15_000);
  expect(timeout).toHaveBeenCalledOnce();
  expect(timeout.mock.calls[0]?.[0].phase).toBe("compile");
  watch.stage({ phase: "ready" });
  vi.advanceTimersByTime(90_000);
  expect(timeout).toHaveBeenCalledOnce();
});

it("stops the clock after ready or disposal and starts a new budget for later edits", () => {
  vi.useFakeTimers();
  const change = vi.fn(), timeout = vi.fn();
  const watch = watchStudioStartup(change, timeout);
  watch.stage({ phase: "ready" });
  const count = change.mock.calls.length;
  vi.advanceTimersByTime(120_000);
  expect(change).toHaveBeenCalledTimes(count);
  expect(timeout).not.toHaveBeenCalled();
  watch.stage({ phase: "compile" });
  vi.advanceTimersByTime(44_000);
  expect(timeout).not.toHaveBeenCalled();
  watch.dispose();
  vi.advanceTimersByTime(10_000);
  expect(timeout).not.toHaveBeenCalled();
});

it("reports real download bytes and a bounded wait without inventing progress", () => {
  vi.useFakeTimers();
  const change = vi.fn(), timeout = vi.fn();
  const watch = watchStudioStartup(change, timeout);
  watch.stage({ phase: "download", loadedBytes: 5, totalBytes: 20 });
  vi.advanceTimersByTime(5_000);
  expect(change.mock.lastCall?.[0]).toMatchObject({ phase: "download", elapsedSeconds: 5, loadedBytes: 5, totalBytes: 20 });
  watch.stage({ phase: "download", loadedBytes: 15, totalBytes: 20 });
  vi.advanceTimersByTime(85_000);
  expect(timeout).toHaveBeenCalledOnce();
});
