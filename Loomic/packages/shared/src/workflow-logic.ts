import { z } from "zod";

const path = z.string().max(120);
export const validWorkflowPath = (value: string) =>
  value
    .split(".")
    .every(
      (part) =>
        /^[a-zA-Z0-9_-]+$/.test(part) &&
        !["__proto__", "prototype", "constructor"].includes(part),
    );
export const workflowConditionSchema = z
  .object({
    field: path,
    operator: z.enum([
      "equals",
      "not_equals",
      "contains",
      "not_empty",
      "greater_than",
      "less_than",
    ]),
    value: z.string().max(2000),
  })
  .strict();
export const workflowWhenSchema = z
  .array(
    z
      .object({ source: z.string(), branch: z.enum(["true", "false"]) })
      .strict(),
  )
  .max(8);
const condition = {
  conditions: z.array(workflowConditionSchema).min(1).max(8),
  match: z.enum(["all", "any"]),
};
const transform = {
  operation: z.enum(["trim", "uppercase", "lowercase", "replace"]),
  search: z.string().max(1000),
  replacement: z.string().max(1000),
};
export const logicNodeConfigs = [
  z.object({ kind: z.literal("condition"), ...condition }).strict(),
  z.object({ kind: z.literal("transform"), ...transform }).strict(),
  z
    .object({ kind: z.literal("template"), template: z.string().max(12000) })
    .strict(),
  z
    .object({ kind: z.literal("merge"), separator: z.string().max(100) })
    .strict(),
  z.object({ kind: z.literal("json"), json: z.string().max(12000) }).strict(),
  z.object({ kind: z.literal("extract"), path }).strict(),
  z
    .object({
      kind: z.literal("delay"),
      seconds: z.number().int().min(1).max(60),
    })
    .strict(),
] as const;
export const logicCommands = [
  z
    .object({
      executor: z.literal("flow.if"),
      fromStep: z.string(),
      ...condition,
    })
    .strict(),
  z
    .object({
      executor: z.literal("text.transform"),
      fromStep: z.string(),
      ...transform,
    })
    .strict(),
  z
    .object({
      executor: z.literal("text.template"),
      fromStep: z.string(),
      template: z.string().max(12000),
    })
    .strict(),
  z
    .object({
      executor: z.literal("text.merge"),
      sources: z.array(z.string()).min(1).max(8),
      separator: z.string().max(100),
    })
    .strict(),
  z
    .object({ executor: z.literal("data.json"), json: z.string().max(12000) })
    .strict(),
  z
    .object({ executor: z.literal("data.extract"), fromStep: z.string(), path })
    .strict(),
  z
    .object({
      executor: z.literal("flow.delay"),
      fromStep: z.string(),
      seconds: z.number().int().min(1).max(60),
    })
    .strict(),
  z
    .object({
      executor: z.literal("result.pinned"),
      sourceGoalId: z.string().uuid(),
      sourceNodeId: z.string(),
      outputType: z.enum(["text", "image", "video", "json"]),
    })
    .strict(),
] as const;
export function readWorkflowField(value: unknown, field: string): unknown {
  const parsed = path.parse(field);
  if (!validWorkflowPath(parsed)) throw new Error("字段路径无效。");
  let cursor = value;
  for (const key of parsed.split(".")) {
    if (
      cursor === null ||
      typeof cursor !== "object" ||
      !Object.hasOwn(cursor, key)
    )
      return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}
export function evaluateWorkflowCondition(
  output: Record<string, unknown>,
  raw: z.infer<typeof workflowConditionSchema>,
): boolean {
  const rule = workflowConditionSchema.parse(raw),
    actual = readWorkflowField(output, rule.field);
  if (rule.operator === "not_empty")
    return (
      actual !== undefined &&
      actual !== null &&
      actual !== "" &&
      (!Array.isArray(actual) || actual.length > 0)
    );
  if (actual === undefined || actual === null) return false;
  if (rule.operator === "greater_than" || rule.operator === "less_than") {
    if (!rule.value.trim() || !Number.isFinite(Number(rule.value)))
      throw new Error("数值条件需要有效的比较值。");
    if (
      !["number", "string"].includes(typeof actual) ||
      String(actual).trim() === "" ||
      !Number.isFinite(Number(actual))
    )
      return false;
    return rule.operator === "greater_than"
      ? Number(actual) > Number(rule.value)
      : Number(actual) < Number(rule.value);
  }
  const text =
    typeof actual === "object" ? JSON.stringify(actual) : String(actual);
  return rule.operator === "contains"
    ? text.includes(rule.value)
    : rule.operator === "equals"
      ? text === rule.value
      : text !== rule.value;
}
