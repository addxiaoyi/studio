import { z } from "zod";
import { desktopAgentTaskRequestSchema } from "./desktop-control.js";
import { creativeCommands } from "./creative-workflow.js";
import { logicCommands, workflowWhenSchema } from "./workflow-logic.js";

export const GOAL_PLAN_TIMEOUT_MS = 120_000;

const url = z.string().url().max(2048).refine(value => /^https?:\/\//i.test(value) && !value.match(/^https?:\/\/([^/?#]*)/i)?.[1]?.includes("@"));
export const goalCommandSchema = z.discriminatedUnion("executor", [
  ...creativeCommands,
  ...logicCommands,
  z.strictObject({ executor: z.literal("canvas.asset"), elementId: z.string().min(1).max(200), assetId: z.string().uuid(), mediaType: z.enum(["image", "video"]) }),
  z.strictObject({ executor: z.literal("web.search"), query: z.string().trim().min(1).max(500) }),
  z.strictObject({ executor: z.literal("web.capture"), url: url.optional(), fromStep: z.string().optional(), pageLimit: z.number().int().min(1).max(5), record: z.boolean() }),
  z.strictObject({ executor: z.literal("desktop.actions"), request: desktopAgentTaskRequestSchema }),
  z.strictObject({ executor: z.literal("media.trim"), fromStep: z.string(), sourceAssetId: z.string().uuid().optional(), start: z.number().nonnegative().max(7200), end: z.number().positive().max(7200), aspect: z.enum(["original", "portrait", "landscape"]) }),
  z.strictObject({ executor: z.literal("result.deliver"), sources: z.array(z.string()).min(1).max(8) }),
]);
export const goalExecutionStepSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), title: z.string().min(1).max(300),
  dependsOn: z.array(z.string()).max(8), command: goalCommandSchema,
  completion: z.string().min(1).max(500),
  when: workflowWhenSchema.optional(),
});
export const goalExecutionPlanSchema = z.strictObject({
  summary: z.string().min(1).max(1500), steps: z.array(goalExecutionStepSchema).min(2).max(64),
}).superRefine((plan, context) => {
  const seen = new Map<string, z.infer<typeof goalExecutionStepSchema>>();
  for (const step of plan.steps) {
    if (seen.has(step.id) || step.dependsOn.some(id => !seen.has(id))) context.addIssue({ code: "custom", message: "步骤ID重复或依赖顺序无效。" });
    if(step.when?.some(rule=>{const source=seen.get(rule.source)?.command;return !step.dependsOn.includes(rule.source)||!(source?.executor==="flow.if"?["true","false"].includes(rule.branch):source?.executor==="flow.switch"&&(rule.branch==="default"||source.cases.some(item=>item.id===rule.branch)));})||new Set(step.when?.map(rule=>rule.source)).size!==(step.when?.length??0))context.addIssue({code:"custom",message:"分支条件必须来自直接依赖的有效分支出口。"});
    if(step.dependsOn.some(id=>["flow.if","flow.switch"].includes(seen.get(id)?.command.executor??"")&&!step.when?.some(rule=>rule.source===id)))context.addIssue({code:"custom",message:"分支节点的下游必须明确选择出口。"});
    if(step.command.executor==="flow.switch"&&(step.command.cases.some(route=>route.id==="default")||new Set(step.command.cases.map(route=>route.id)).size!==step.command.cases.length))context.addIssue({code:"custom",message:"Switch 出口标识重复或占用了默认出口。"});
    if (step.command.executor === "web.capture") {
      const { url, fromStep } = step.command;
      if (Boolean(url) === Boolean(fromStep) || (fromStep && (seen.get(fromStep)?.command.executor !== "web.search" || !step.dependsOn.includes(fromStep)))) context.addIssue({ code: "custom", message: "浏览步骤需要网址或已完成的搜索依赖。" });
    }
    if (step.command.executor === "result.deliver" && step.command.sources.some(id => !seen.has(id) || !step.dependsOn.includes(id))) context.addIssue({ code: "custom", message: "结果步骤必须依赖其来源。" });
    if (step.command.executor === "media.trim") {
      const visited=new Set<string>();
      const videoSource=(id:string):boolean=>{if(visited.has(id))return false;visited.add(id);const command=seen.get(id)?.command;return command?.executor==="web.capture"&&command.record||command?.executor==="canvas.asset"&&command.mediaType==="video"||command?.executor==="media.trim"||command?.executor==="media.compose"||command?.executor==="media.generate"&&command.mediaType==="video"||command?.executor==="result.pinned"&&command.outputType==="video"||Boolean(command&&(command.executor==="flow.if"||command.executor==="flow.switch"||command.executor==="flow.delay")&&videoSource(command.fromStep));};
      const video = videoSource(step.command.fromStep);
      if (step.command.end <= step.command.start || !step.dependsOn.includes(step.command.fromStep) || !video) context.addIssue({ code: "custom", message: "剪辑步骤需要有效视频来源和时间范围。" });
    }
    const command = step.command;
    if("fromStep" in command&&command.executor!=="web.capture"&&typeof command.fromStep==="string"&&(!seen.has(command.fromStep)||!step.dependsOn.includes(command.fromStep)))context.addIssue({code:"custom",message:"节点缺少已连接的输入来源。"});
    if(command.executor==="text.merge"&&command.sources.some(id=>!seen.has(id)||!step.dependsOn.includes(id)))context.addIssue({code:"custom",message:"合并节点缺少输入来源。"});
    if (["ai.write", "media.generate", "media.compose"].includes(command.executor) && "sources" in command && command.sources.some(id => !seen.has(id) || !step.dependsOn.includes(id))) context.addIssue({ code: "custom", message: "创作节点必须依赖其输入来源。" });
    if ((command.executor === "content.shot" || command.executor === "media.frame") && (!seen.has(command.fromStep) || !step.dependsOn.includes(command.fromStep))) context.addIssue({ code: "custom", message: "镜头与抽帧节点缺少来源。" });
    seen.set(step.id, step);
  }
  if (plan.steps.at(-1)?.command.executor !== "result.deliver" || plan.steps.filter(step => step.command.executor === "result.deliver").length !== 1) context.addIssue({ code: "custom", message: "计划必须以唯一的结果交付步骤结束。" });
});
export type GoalCommand = z.infer<typeof goalCommandSchema>;
export type GoalExecutionStep = z.infer<typeof goalExecutionStepSchema>;
export type GoalExecutionPlan = z.infer<typeof goalExecutionPlanSchema>;
export const goalStepReceiptSchema = z.object({
  id: z.string().uuid(), stepId: z.string(), title: z.string(), executor: z.string(),
  state: z.enum(["queued", "running", "waiting_approval", "waiting_desktop", "review", "succeeded", "failed", "canceled"]),
  attempt: z.number().int(), command: goalCommandSchema, output: z.record(z.unknown()).nullable(), error: z.string().nullable(),
  fingerprint: z.string(), approval: z.enum(["not_required", "pending", "approved", "consumed", "rejected", "expired"]), expiresAt: z.string().nullable(),
});
