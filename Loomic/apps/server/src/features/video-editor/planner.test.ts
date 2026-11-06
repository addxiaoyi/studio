import { afterEach, expect, it, vi } from "vitest";
import { assertPlannerCredential, invokeEditorPlanner } from "./planner.js";

afterEach(() => vi.useRealTimers());

it("rejects known placeholder credentials before contacting a provider", () => {
  for (const key of [undefined, "", "your-api-key", "sk-placeholder", "sk-your-key-here"]) expect(() => assertPlannerCredential(key)).toThrow("模型");
  expect(() => assertPlannerCredential("test-valid-fixture-key")).not.toThrow();
});

it("bounds an unresponsive model, aborts it and discards a late reply", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  let finish!: (value: unknown) => void;
  const invoke = (_messages: unknown, options: { signal: AbortSignal }) => {
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = invokeEditorPlanner({ invoke } as never, [], 50);
  const assertion = expect(pending).rejects.toMatchObject({ code: "video_plan_timeout" });
  await vi.advanceTimersByTimeAsync(50);
  await assertion;
  expect(signal?.aborted).toBe(true);
  finish({ content: "late reply" });
  expect(vi.getTimerCount()).toBe(0);
});

it("clears its deadline after a successful reply", async () => {
  vi.useFakeTimers();
  expect(await invokeEditorPlanner({ invoke: async () => ({ content: "{}" }) } as never, [], 50)).toEqual({ content: "{}" });
  expect(vi.getTimerCount()).toBe(0);
});
