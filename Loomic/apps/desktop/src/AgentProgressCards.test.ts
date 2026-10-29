import { describe, expect, it } from "vitest";
import { labelEvent } from "./AgentProgressCards.js";

describe("desktop task event labels", () => {
  it("shows observe and planning rounds instead of the raw step id", () => {
    expect(labelEvent({ eventType: "step", stepId: "reobserve", detail: "Plan exhausted; requesting round 4." })).toBe("Round 4: observe and re-plan");
  });

  it("names grounding, deadline, and expired approval events", () => {
    expect(labelEvent({ eventType: "visual_grounding" })).toBe("Visual grounding");
    expect(labelEvent({ eventType: "deadline_warning" })).toContain("current action");
    expect(labelEvent({ eventType: "approval_expired" })).toContain("expired");
  });
});
