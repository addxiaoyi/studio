import { describe, expect, it } from "vitest";
import { goalExecutionPlanSchema } from "@helstera/shared";
import { executableGoalPlan, parseGoalPlan } from "./goal-planner.js";

const plan = { summary: "查看网址", steps: [
  { id: "browse", title: "浏览", dependsOn: [], command: { executor: "web.capture" as const, url: "https://example.com", pageLimit: 1, record: false }, completion: "截图证据" },
  { id: "deliver", title: "交付", dependsOn: ["browse"], command: { executor: "result.deliver" as const, sources: ["browse"] }, completion: "保存结果" },
] };
describe("structured goal planner", () => {
  it("normalizes irrelevant video fields on image plans while rejecting unsupported video resolution", () => {
    const image={summary:"生成参考图",steps:[{id:"image",title:"生成图片",dependsOn:[],completion:"保存图片",command:{executor:"media.generate",sources:[],mediaType:"image",model:"configured-2k-image",prompt:"机器人",aspectRatio:"16:9",resolution:"2K",duration:0}},{id:"deliver",title:"交付",dependsOn:["image"],completion:"保存",command:{executor:"result.deliver",sources:["image"]}}]};
    expect(parseGoalPlan(JSON.stringify(image)).steps[0]!.command).toMatchObject({model:"configured-2k-image",mediaType:"image",resolution:"720p",duration:5});
    image.steps[0]!.command.mediaType="video";
    expect(()=>parseGoalPlan(JSON.stringify(image))).toThrow("动作参数");
  });
  it("reports invalid model JSON and unsupported identifiers without leaking a validator dump", () => {
    expect(() => parseGoalPlan("not json")).toThrow("有效的 JSON");
    expect(() => parseGoalPlan(JSON.stringify({ ...plan, steps: [{ ...plan.steps[0], id: "step_1" }, plan.steps[1]] }))).toThrow("步骤标识");
    expect(parseGoalPlan("  ```json\n" + JSON.stringify(plan) + "\n```  ")).toEqual(plan);
    expect(() => parseGoalPlan('{"error":"需要提供网址"}')).toThrow("需要提供网址");
  });
  it("retains explicit mode choices and refuses a server plan for native work", () => {
    expect(() => executableGoalPlan(plan, { goal: "目标", idempotencyKey: "test", executionMode: "windows_ui" })).toThrow("明确选择");
    expect(executableGoalPlan(plan, { goal: "目标", idempotencyKey: "test", executionMode: "automatic" }).version).toBe(2);
  });
  it("rejects cycles, missing dependencies and credentials in URLs", () => {
    expect(goalExecutionPlanSchema.safeParse({ ...plan, steps: [plan.steps[1],plan.steps[0]] }).success).toBe(false);
    expect(goalExecutionPlanSchema.safeParse({ ...plan, steps: [{...plan.steps[0],command:{...plan.steps[0]!.command,url:'https://user:secret@example.com'}},plan.steps[1]] }).success).toBe(false);
  });
});
