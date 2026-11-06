import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";

import { agentGoalCreateRequestSchema } from "@helstera/shared";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { AgentGoalService } from "../features/agent-goals/agent-goal-service.js";
import { WebsiteAssistantHub } from "../features/website-capture/assistant-hub.js";
import { createGoalPlanner } from "../features/agent-goals/goal-planner.js";
import { decideGoalStep, reviewGoalStep } from "../features/agent-goals/goal-step-store.js";
import type { ServerEnv } from "../config/env.js";
import type { SettingsService } from "../features/settings/settings-service.js";
import { z } from "zod";

type GoalRouteOptions = {
  db: Pool;
  auth: RequestAuthenticator;
  viewerService: ViewerService;
  goalService?: AgentGoalService;
  assistantHub: WebsiteAssistantHub;
  env?: ServerEnv;
  settingsService?: SettingsService;
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
      const planner = options.env && options.settingsService && process.env.HELSTERA_GOAL_STEPS === "1" ? createGoalPlanner(options.env, options.settingsService, user) : undefined;
      const plannedService = planner ? new AgentGoalService(options.db, planner) : service;
      const goal = await plannedService.create(user.id, viewer.workspace.id, agentGoalCreateRequestSchema.parse(request.body));
      return reply.code(202).send({ ok: true, data: goal });
    } catch (error) {
      return sendGoalError(error, reply);
    }
  });

  app.post<{ Params: { goalId: string; stepId: string } }>("/api/agent/goals/:goalId/steps/:stepId/decision", async (request, reply) => {
    const user = await options.auth.authenticate(request); if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const body = z.strictObject({ decision: z.enum(["approve", "reject"]), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).parse(request.body);
      return await decideGoalStep(options.db, user.id, viewer.workspace.id, request.params.goalId, request.params.stepId, body.fingerprint, body.decision);
    } catch (error) { return sendGoalError(error, reply); }
  });
  app.post<{ Params: { goalId: string; stepId: string } }>("/api/agent/goals/:goalId/steps/:stepId/review", async (request, reply) => {
    const user = await options.auth.authenticate(request); if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const body = z.strictObject({ outcome: z.enum(["observed_completed", "observed_not_completed"]) }).parse(request.body);
      return await reviewGoalStep(options.db, user.id, viewer.workspace.id, request.params.goalId, request.params.stepId, body.outcome);
    } catch (error) { return sendGoalError(error, reply); }
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

  app.get<{ Params: { goalId: string } }>("/api/agent/goals/:goalId/events", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const goal = await service.get(user.id, viewer.workspace.id, request.params.goalId);
      return reply.send({ ok: true, data: goal.activities });
    } catch (error) {
      return sendGoalError(error, reply);
    }
  });

  app.get<{ Params: { goalId: string } }>("/api/agent/goals/:goalId/assets", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const goal = await service.get(user.id, viewer.workspace.id, request.params.goalId);
      return reply.send({ ok: true, data: goal.outputs });
    } catch (error) {
      return sendGoalError(error, reply);
    }
  });

  app.post<{ Params: { goalId: string } }>("/api/agent/goals/:goalId/confirm", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({ ok: true, data: await service.confirm(user.id, viewer.workspace.id, request.params.goalId) });
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

  app.post<{ Params: { goalId: string; approvalId: string } }>("/api/agent/goals/:goalId/approvals/:approvalId/review", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    const body = request.body as { outcome?: unknown } | null;
    if (body?.outcome !== "observed_completed" && body?.outcome !== "observed_not_completed") {
      return reply.code(400).send({ ok: false, error: { code: "invalid_review", message: "A valid observed outcome is required." } });
    }
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      return reply.send({ ok: true, data: await service.reviewInterruptedAction(user.id, viewer.workspace.id, request.params.goalId, request.params.approvalId, body.outcome) });
    } catch (error) {
      return sendGoalError(error, reply);
    }
  });
}
