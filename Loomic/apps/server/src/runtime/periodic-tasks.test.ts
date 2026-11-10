import { expect, it, vi } from "vitest";
import { PeriodicTasks } from "./periodic-tasks.js";

it("drains current maintenance without starting overlapping or later cycles", async () => {
  vi.useFakeTimers();
  try {
    let finish!: () => void;
    const task = vi.fn(() => new Promise<void>(done => { finish = done; }));
    const tasks = new PeriodicTasks(vi.fn());
    tasks.every("cleanup", 100, task);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);
    let closed = false;
    const stopped = tasks.stop().then(() => { closed = true; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(closed).toBe(false);
    finish();
    await stopped;
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
