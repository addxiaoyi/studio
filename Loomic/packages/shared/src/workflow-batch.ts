import { z } from "zod";

export const WORKFLOW_MAX_ITEMS = 100;
export const workflowBatchOperationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("transform"),
      operation: z.enum(["trim", "uppercase", "lowercase", "replace"]),
      search: z.string().max(1000),
      replacement: z.string().max(1000),
    })
    .strict(),
  z
    .object({ kind: z.literal("template"), template: z.string().max(4000) })
    .strict(),
  z
    .object({ kind: z.literal("extract"), path: z.string().min(1).max(120) })
    .strict(),
]);
export const workflowSplitSettings = {
  source: z.enum(["json", "lines"]),
  path: z.string().max(120),
  separator: z.string().min(1).max(100),
  maxItems: z.number().int().min(1).max(WORKFLOW_MAX_ITEMS),
};
export const workflowBatchSettings = {
  maxItems: z.number().int().min(1).max(WORKFLOW_MAX_ITEMS),
  batchSize: z.number().int().min(1).max(10),
  operations: z.array(workflowBatchOperationSchema).min(1).max(8),
};
export const batchNodeConfigs = [
  z.object({ kind: z.literal("split"), ...workflowSplitSettings }).strict(),
  z.object({ kind: z.literal("batch"), ...workflowBatchSettings }).strict(),
] as const;
export const batchCommands = [
  z
    .object({
      executor: z.literal("data.split"),
      fromStep: z.string(),
      ...workflowSplitSettings,
    })
    .strict(),
  z
    .object({
      executor: z.literal("flow.batch"),
      fromStep: z.string(),
      ...workflowBatchSettings,
    })
    .strict(),
] as const;
