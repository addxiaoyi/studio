import type { AgentGoalPlan } from "@helstera/shared";
import type { GoalStepRow } from "./goal-step-store.js";

export function activeStepInputs(
  plan: AgentGoalPlan,
  stepId: string,
  previous: GoalStepRow[],
  dependencies: string[],
): GoalStepRow[] {
  const rules = plan.steps.find((step) => step.id === stepId)?.when ?? [];
  return dependencies.flatMap((id) => {
    const source = previous.find((step) => step.step_id === id);
    if (
      !source ||
      source.state !== "succeeded" ||
      source.output?.skipped === true
    )
      return [];
    const required = rules.filter((rule) => rule.source === id);
    if (required.length && typeof source.output?.condition !== "boolean")
      throw new Error("IF 节点缺少可核验的分支结果。");
    return required.every(
      (rule) => String(source.output?.condition) === rule.branch,
    )
      ? [source]
      : [];
  });
}
export function shouldSkipStep(
  plan: AgentGoalPlan,
  step: GoalStepRow,
  previous: GoalStepRow[],
): boolean {
  if (!step.depends_on.length || step.executor === "result.deliver")
    return false;
  const active = activeStepInputs(
    plan,
    step.step_id,
    previous,
    step.depends_on,
  );
  return step.executor === "text.merge"
    ? active.length === 0
    : active.length !== step.depends_on.length;
}
