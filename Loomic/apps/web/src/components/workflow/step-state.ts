import type { AgentGoal } from "@helstera/shared";
export function workflowStepState(step: NonNullable<AgentGoal["executionSteps"]>[number] | undefined) {
  if (!step) return "draft";
  if(step.output?.skipped===true)return "skipped";
  if(step.executor==="result.pinned"&&step.output?.pinned===true&&step.state==="succeeded")return "pinned";
  if(step.executor==="flow.delay"&&step.state==="waiting_desktop")return "waiting";
  if (step.executor === "media.generate" && ["running","waiting_desktop"].includes(step.state)) {
    if (step.output?.generationJob) return "running";
    if (step.output?.generationApproval) return "waiting_approval";
  }
  return step.state;
}
