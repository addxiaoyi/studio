import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { AgentGoalTransitionError } from "../features/agent-goals/agent-goal-service.js";
import { registerAgentGoalRoutes } from "./agent-goals.js";

const user = { id: "user-1", email: "user@example.test" };
const viewer = { workspace: { id: "workspace-1" } };

function buildApp(transition: ReturnType<typeof vi.fn>) {
  const app = Fastify();
  registerAgentGoalRoutes(app, {
    db: {} as never,
    auth: { authenticate: vi.fn().mockResolvedValue(user) } as never,
    viewerService: { ensureViewer: vi.fn().mockResolvedValue(viewer) } as never,
    goalService: { transition, get: vi.fn(), assertApproval: vi.fn() } as never,
    assistantHub: {} as never,
  });
  return app;
}

describe("Agent Goal transition routes", () => {
  it("passes the retry operation through to the workspace-scoped service", async () => {
    const transition = vi.fn().mockResolvedValue({ id: "goal-1", status: "running" });
    const app = buildApp(transition);

    const response = await app.inject({ method: "POST", url: "/api/agent/goals/goal-1/retry" });

    expect(response.statusCode).toBe(200);
    expect(transition).toHaveBeenCalledWith("user-1", "workspace-1", "goal-1", "retry");
    await app.close();
  });

  it("maps an invalid state transition to conflict", async () => {
    const transition = vi.fn().mockRejectedValue(new AgentGoalTransitionError("Agent goal cannot retry from status completed."));
    const app = buildApp(transition);

    const response = await app.inject({ method: "POST", url: "/api/agent/goals/goal-1/retry" });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain("cannot retry");
    await app.close();
  });
});
