import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";

import { agentGoalCreateRequestSchema } from "@helstera/shared";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { AgentGoalService } from "../features/agent-goals/agent-goal-service.js";
import { WebsiteAssistantHub } from "../features/website-capture/assistant-hub.js";

type GoalRouteOptions = {
  db: Pool;
  auth: RequestAuthenticator;
  viewerService: ViewerService;
  goalService?: AgentGoalService;
  assistantHub: WebsiteAssistantHub;
};

function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Authentication required." } });
}

function sendGoalError(error: unknown, reply: FastifyReply) {
  const message = error instanceof Error ? error.message : "Agent goal request failed.";
  const explicitStatus = typeof (error as { statusCode?: unknown }).statusCode === "number"
    ? Number((error as { statusCode: number }).statusCode)
    : null;
  const status = explicitStatus ?? (/not found/i.test(message) ? 404 : /not available|not configured|not connected/i.test(message) ? 409 : 400);
  return reply.code(status).send({ ok: false, error: { code: "agent_goal_error", message } });
}

export function registerAgentGoalRoutes(app: FastifyInstance, options: GoalRouteOptions) {
  const service = options.goalService ?? new AgentGoalService(options.db);
  app.post("/api/agent/goals", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const goal = await service.create(user.id, viewer.workspace.id, agentGoalCreateRequestSchema.parse(request.body));
      return reply.code(202).send({ ok: true, data: goal });
    } catch (error) {
      return sendGoalError(error, reply);
    }
  });

  app.get("/api/agent/goals", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({ ok: true, data: await service.list(user.id, viewer.workspace.id) });
    } catch (error) {
      return sendGoalError(error, reply);
    }
  });

  app.get<{ Params: { goalId: string } }>("/api/agent/goals/:goalId", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({ ok: true, data: await service.get(user.id, viewer.workspace.id, request.params.goalId) });
    } catch (error) {
      return sendGoalError(error, reply);
    }
  });

  for (const suffix of ["pause", "resume", "cancel", "retry"] as const) {
    app.post<{ Params: { goalId: string } }>(`/api/agent/goals/:goalId/${suffix}`, async (request, reply) => {
      const user = await options.auth.authenticate(request);
      if (!user) return unauthorized(reply);
      try {
        const viewer = await options.viewerService.ensureViewer(user);
        return reply.send({ ok: true, data: await service.transition(user.id, viewer.workspace.id, request.params.goalId, suffix) });
      } catch (error) {
        return sendGoalError(error, reply);
      }
    });
  }

  for (const [decision, operation] of [["approve", "approveDesktopAction"], ["reject", "rejectDesktopAction"]] as const) {
    app.post<{ Params: { goalId: string; approvalId: string } }>(`/api/agent/goals/:goalId/approvals/:approvalId/${decision}`, async (request, reply) => {
      const user = await options.auth.authenticate(request);
      if (!user) return unauthorized(reply);
      try {
        const viewer = await options.viewerService.ensureViewer(user);
        await service.get(user.id, viewer.workspace.id, request.params.goalId);
        await service.assertApproval(user.id, viewer.workspace.id, request.params.goalId, request.params.approvalId);
        const result = await options.assistantHub[operation](user.id, viewer.workspace.id, request.params.approvalId);
        return reply.send({ ok: true, data: result });
      } catch (error) {
        return sendGoalError(error, reply);
      }
    });
  }
}
