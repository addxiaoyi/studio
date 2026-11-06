import { afterEach, expect, it, vi } from "vitest";
import { createGoalPlanner } from "./goal-planner.js";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("../../agent/deep-agent.js", () => ({ createStreamingChatModel: () => ({ invoke }) }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

const plan = { summary: "浏览网页", steps: [
  { id: "read", title: "读取", dependsOn: [], completion: "保存截图", command: { executor: "web.capture", url: "https://example.com/", pageLimit: 1, record: false } },
  { id: "deliver", title: "交付", dependsOn: ["read"], completion: "保存结果", command: { executor: "result.deliver", sources: ["read"] } },
] };
const planner = () => createGoalPlanner({} as never, { getChatModelConfig: async () => ({ model: "test" }) } as never, { id: "test" } as never);

it("allows a slow structured plan to finish without retrying the provider", async () => {
  vi.useFakeTimers();
  invoke.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ content: JSON.stringify(plan) }), 90_000)));
  const pending = planner()("workspace", { goal: "浏览网页", idempotencyKey: "slow", executionMode: "automatic" });
  const assertion = expect(pending).resolves.toMatchObject({ version: 2, summary: plan.summary });
  await vi.advanceTimersByTimeAsync(90_000);
  await assertion;
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("aborts the provider at the goal deadline and discards its late plan", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  let finish!: (value: unknown) => void;
  invoke.mockImplementation((_messages, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  const pending = planner()("workspace", { goal: "浏览网页", idempotencyKey: "late", executionMode: "automatic" });
  const assertion = expect(pending).rejects.toThrow("超时");
  await vi.advanceTimersByTimeAsync(119_999);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await assertion;
  expect(signal?.aborted).toBe(true);
  finish({ content: JSON.stringify(plan) });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
