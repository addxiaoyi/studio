import { describe, expect, it } from "vitest";
import { RecorderLock } from "./recorder-lock.js";

describe("RecorderLock", () => {
  it("prevents two tasks from sharing the recorder and allows reuse after release", () => {
    const lock = new RecorderLock();
    const release = lock.acquire("task-1");

    expect(() => lock.acquire("task-2")).toThrow("busy");
    release();
    expect(() => lock.acquire("task-2")).not.toThrow();
  });

  it("makes release idempotent", () => {
    const lock = new RecorderLock();
    const release = lock.acquire("task-1");

    release();
    release();
    expect(() => lock.acquire("task-2")).not.toThrow();
  });
});
