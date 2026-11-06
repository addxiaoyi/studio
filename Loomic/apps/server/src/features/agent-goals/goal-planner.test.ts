import { describe, expect, it } from "vitest";
import { goalExecutionPlanSchema } from "@helstera/shared";
import { executableGoalPlan } from "./goal-planner.js";

const plan = { summary: "查看网址", steps: [
  { id: "browse", title: "浏览", dependsOn: [], command: { executor: "web.capture" as const, url: "https://example.com", pageLimit: 1, record: false }, completion: "截图证据" },
  { id: "deliver", title: "交付", dependsOn: ["browse"], command: { executor: "result.deliver" as const, sources: ["browse"] }, completion: "保存结果" },
] };
describe("structured goal planner", () => {
  it("retains explicit mode choices and refuses a server plan for native work", () => {
    expect(() => executableGoalPlan(plan, { goal: "目标", idempotencyKey: "test", executionMode: "windows_ui" })).toThrow("明确选择");
    expect(executableGoalPlan(plan, { goal: "目标", idempotencyKey: "test", executionMode: "automatic" }).version).toBe(2);
  });
  it("rejects cycles, missing dependencies and credentials in URLs", () => {
    expect(goalExecutionPlanSchema.safeParse({ ...plan, steps: [plan.steps[1],plan.steps[0]] }).success).toBe(false);
    expect(goalExecutionPlanSchema.safeParse({ ...plan, steps: [{...plan.steps[0],command:{...plan.steps[0]!.command,url:'https://user:secret@example.com'}},plan.steps[1]] }).success).toBe(false);
  });
});
