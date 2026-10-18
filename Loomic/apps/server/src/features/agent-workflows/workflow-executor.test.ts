import { describe, expect, it } from "vitest";
import { agentWorkflowPlanSchema } from "@helstera/shared";
import { findWorkflowStep, parseWorkflowPlan } from "./workflow-executor.js";

describe("agent workflow plan execution helpers", () => {
  it("keeps dependency and approval metadata structured", () => {
    const plan = parseWorkflowPlan(agentWorkflowPlanSchema.parse({
      goal: "Draft a launch post",
      status: "paused",
      approvalGate: { required: true, stepId: "generate", reason: "Generation needs confirmation." },
      steps: [
        { id: "draft", tool: "persist_draft", title: "Draft", status: "completed", dependsOn: [], retryable: true, requiresApproval: false, output: { editable: true } },
        { id: "generate", tool: "generate_media", title: "Generate", status: "awaiting_approval", dependsOn: ["draft"], retryable: true, requiresApproval: true, input: { mediaType: "image" } },
      ],
    }));

    expect(findWorkflowStep(plan, "generate")).toMatchObject({ status: "awaiting_approval", input: { mediaType: "image" } });
    expect(findWorkflowStep(plan, "missing")).toBeNull();
  });
});
