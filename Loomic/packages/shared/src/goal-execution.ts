import { z } from "zod";
import { desktopAgentTaskRequestSchema } from "./desktop-control.js";

const url = z.string().url().max(2048).refine(value => /^https?:\/\//i.test(value) && !value.match(/^https?:\/\/([^/?#]*)/i)?.[1]?.includes("@"));
export const goalCommandSchema = z.discriminatedUnion("executor", [
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
});
export const goalExecutionPlanSchema = z.strictObject({
  summary: z.string().min(1).max(1500), steps: z.array(goalExecutionStepSchema).min(2).max(12),
}).superRefine((plan, context) => {
  const seen = new Map<string, z.infer<typeof goalExecutionStepSchema>>();
  for (const step of plan.steps) {
    if (seen.has(step.id) || step.dependsOn.some(id => !seen.has(id))) context.addIssue({ code: "custom", message: "步骤ID重复或依赖顺序无效。" });
    if (step.command.executor === "web.capture") {
      const { url, fromStep } = step.command;
      if (Boolean(url) === Boolean(fromStep) || (fromStep && (seen.get(fromStep)?.command.executor !== "web.search" || !step.dependsOn.includes(fromStep)))) context.addIssue({ code: "custom", message: "浏览步骤需要网址或已完成的搜索依赖。" });
    }
    if (step.command.executor === "result.deliver" && step.command.sources.some(id => !seen.has(id) || !step.dependsOn.includes(id))) context.addIssue({ code: "custom", message: "结果步骤必须依赖其来源。" });
    if (step.command.executor === "media.trim" && (step.command.end <= step.command.start || !step.dependsOn.includes(step.command.fromStep) || seen.get(step.command.fromStep)?.command.executor !== "web.capture")) context.addIssue({ code: "custom", message: "剪辑步骤需要有效录制来源和时间范围。" });
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
