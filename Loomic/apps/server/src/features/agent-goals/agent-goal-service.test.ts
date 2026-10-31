import { describe, expect, it, vi } from "vitest";

import { AgentGoalService, AgentGoalTransitionError, buildAgentGoalPlan } from "./agent-goal-service.js";

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

describe("Agent goal confirmation boundaries", () => {
  it("rejects pausing a draft instead of allowing pause/resume to bypass confirmation", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ status: "draft" }] });
    const service = new AgentGoalService({ query } as never);

    await expect(service.transition("user", "workspace", "goal", "pause")).rejects.toBeInstanceOf(AgentGoalTransitionError);
    expect(query).toHaveBeenCalledOnce();
  });

  it("does not retry a canceled draft without confirmation or a legacy task", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ status: "canceled" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: "canceled" }] });
    const service = new AgentGoalService({ query } as never);

    await expect(service.transition("user", "workspace", "goal", "retry")).rejects.toBeInstanceOf(AgentGoalTransitionError);
    expect(query.mock.calls[2]?.[0]).toContain("confirmed_at is not null");
  });

  it("confirms and records the event atomically, and returns the current goal on repeated confirmation", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "goal" }] });
    const service = new AgentGoalService({ query } as never);
    const get = vi.spyOn(service, "get").mockResolvedValue({ id: "goal", status: "running" } as never);

    await service.confirm("user", "workspace", "goal");
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("with confirmed as");
    expect(query.mock.calls[0]?.[0]).toContain("execution_policy='approval_required'");
    expect(query.mock.calls[0]?.[0]).toContain("insert into agent_goal_events");

    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ status: "running" }] });
    await service.confirm("user", "workspace", "goal");
    expect(get).toHaveBeenCalledTimes(2);
  });
});
