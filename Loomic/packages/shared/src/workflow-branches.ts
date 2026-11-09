import type { WorkflowNode } from "./canvas-workflow.js";
import { validWorkflowPath } from "./workflow-logic.js";

export function workflowOutlets(
  node?: WorkflowNode,
): Array<{ value: string; label: string }> {
  if (node?.config.kind === "condition")
    return [
      { value: "true", label: "是" },
      { value: "false", label: "否" },
    ];
  if (node?.config.kind === "switch")
    return [
      ...node.config.cases.map((rule) => ({
        value: rule.id,
        label: rule.title,
      })),
      { value: "default", label: "默认" },
    ];
  return [];
}
export function workflowLogicIssue(
  config: WorkflowNode["config"],
): string | null {
  if (config.kind === "switch") {
    const ids = config.cases.map((rule) => rule.id);
    if (ids.includes("default") || new Set(ids).size !== ids.length)
      return "Switch 出口标识重复或占用了默认出口。";
  }
  const rules =
    config.kind === "switch"
      ? config.cases.flatMap((rule) => rule.conditions)
      : config.kind === "condition"
        ? config.conditions
        : [];
  if (rules.some((rule) => !validWorkflowPath(rule.field)))
    return "填写有效的判断字段路径，例如 text 或 json.score。";
  if (
    rules.some(
      (rule) =>
        ["greater_than", "less_than"].includes(rule.operator) &&
        (!rule.value.trim() || !Number.isFinite(Number(rule.value))),
    )
  )
    return "数值条件需要有效的比较值。";
  if (config.kind === "split" && config.path && !validWorkflowPath(config.path))
    return "列表字段路径无效。";
  if (config.kind === "batch") {
    if (
      config.operations.some(
        (op) => op.kind === "extract" && !validWorkflowPath(op.path),
      )
    )
      return "批量提取字段路径无效。";
    if (
      config.operations.some(
        (op) =>
          op.kind === "transform" && op.operation === "replace" && !op.search,
      )
    )
      return "批量替换需要填写查找文字。";
  }
  return null;
}
