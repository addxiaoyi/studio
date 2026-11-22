import type { z } from "zod";
import {
  evaluateWorkflowCondition,
  readWorkflowField,
  workflowBranchConfigSchema,
  type workflowConditionSchema,
} from "./workflow-logic.js";

export type WorkflowBranchConfig = z.infer<typeof workflowBranchConfigSchema>;
type Condition = z.infer<typeof workflowConditionSchema>;
export type WorkflowBranchEvaluation = {
  branches: string[];
  routes: {
    id: string;
    title: string;
    matched: boolean;
    conditions: { rule: Condition; actual: unknown; matched: boolean }[];
  }[];
};

/** Use the same ordered branch decisions for execution and local previews. */
export function evaluateWorkflowBranches(
  source: Record<string, unknown>,
  raw: WorkflowBranchConfig,
): WorkflowBranchEvaluation {
  const parsed = workflowBranchConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("条件配置无效，请检查字段、比较值和出口设置。");
  }
  const config = parsed.data;
  const candidates =
    config.kind === "condition"
      ? [
          {
            id: "true",
            title: "是",
            conditions: config.conditions,
            match: config.match,
          },
        ]
      : config.cases;
  const ids = candidates.map((route) => route.id);
  if (ids.includes("default") || new Set(ids).size !== ids.length) {
    throw new Error("出口标识重复或使用了保留的 default，请重新设置出口。");
  }
  const routes: WorkflowBranchEvaluation["routes"] = [];
  const branches: string[] = [];
  for (const route of candidates) {
    const conditions = route.conditions.map((rule) => ({
      rule,
      actual: readWorkflowField(source, rule.field),
      matched: evaluateWorkflowCondition(source, rule),
    }));
    const matched =
      route.match === "all"
        ? conditions.every((condition) => condition.matched)
        : conditions.some((condition) => condition.matched);
    routes.push({ id: route.id, title: route.title, matched, conditions });
    if (!matched) continue;
    branches.push(route.id);
    if (config.kind === "condition" || config.mode === "first") break;
  }
  if (!branches.length)
    branches.push(config.kind === "condition" ? "false" : "default");
  return { branches, routes };
}
