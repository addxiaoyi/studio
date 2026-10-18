import { describe, expect, it } from "vitest";
import { agentWorkflowPlanSchema, feedAutomationRequestSchema, mediaIntentSchema } from "./automation-contracts.js";

describe("automation contracts", () => {
  it("defaults media audio off", () => {
    expect(mediaIntentSchema.parse({ mediaType: "video" }).enableAudio).toBe(false);
  });

  it("requires an idempotency key for Feed automation", () => {
    expect(feedAutomationRequestSchema.safeParse({ title: "x" }).success).toBe(false);
  });

  it("validates approval-bearing workflow plans", () => {
    const plan = agentWorkflowPlanSchema.parse({
      goal: "prepare a draft",
      status: "planned",
      approvalGate: { required: true },
      steps: [{ id: "draft", tool: "persist_draft", title: "Draft", status: "pending", dependsOn: [], retryable: true, requiresApproval: false }],
    });
    expect(plan.approvalGate.required).toBe(true);
  });
});
