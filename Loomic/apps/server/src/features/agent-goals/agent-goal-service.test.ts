import { describe, expect, it } from "vitest";

import { buildAgentGoalPlan } from "./agent-goal-service.js";

describe("buildAgentGoalPlan", () => {
  it("keeps read-only automatic goals approval-free", () => {
    const plan = buildAgentGoalPlan("Read the public page and summarize it", "isolated_browser");

    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[1]).toMatchObject({
      risk: "automatic",
      requiresApproval: false,
      requiresDesktop: false,
    });
  });

  it("marks native side effects as desktop and approval work", () => {
    const plan = buildAgentGoalPlan("Click the export button and save the recording", "windows_ui");

    expect(plan.steps[1]).toMatchObject({
      risk: "approval",
      requiresApproval: true,
      requiresDesktop: true,
    });
  });
});
