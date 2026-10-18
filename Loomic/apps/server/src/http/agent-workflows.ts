import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { agentWorkflowPlanSchema } from "@helstera/shared";

import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { CreditService } from "../features/credits/credit-service.js";
import type { TierGuard } from "../features/credits/tier-guard.js";
import type { JobService } from "../features/jobs/job-service.js";
import {
  parseWorkflowPlan,
  retryAgentWorkflow,
  runAgentWorkflow,
  type WorkflowExecutionContext,
  WorkflowExecutionError,
} from "../features/agent-workflows/workflow-executor.js";

type WorkflowOptions = {
  db: Pool;
  auth: RequestAuthenticator;
  viewerService: ViewerService;
  jobService?: JobService;
  creditService?: CreditService;
  tierGuard?: TierGuard;
};

function unauthorized(reply: any) {
  return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Missing or invalid bearer token." } });
}

async function session(request: any, reply: any, options: WorkflowOptions) {
  const user = await options.auth.authenticate(request);
  if (!user) return unauthorized(reply);
  return { user, viewer: await options.viewerService.ensureViewer(user) };
}

function buildPlan(goal: string, media: Record<string, unknown> | undefined, context: Record<string, unknown>, publishRequested: boolean) {
  const steps: Array<Record<string, unknown>> = [
    { id: "inspect", tool: "inspect_canvas", title: "Inspect current workspace", status: "pending", dependsOn: [], retryable: true, requiresApproval: false },
    { id: "draft", tool: "persist_draft", title: "Prepare an editable draft", status: "pending", dependsOn: ["inspect"], retryable: true, requiresApproval: false, input: { goal } },
    { id: "generate", tool: "generate_media", title: "Generate requested media", status: "pending", dependsOn: ["draft"], retryable: true, requiresApproval: true, input: { ...context, ...(media ?? {}) } },
  ];
  if (publishRequested) {
    steps.push({ id: "publish", tool: "publish_external", title: "Publish externally", status: "pending", dependsOn: ["generate"], retryable: false, requiresApproval: true });
  }
  return agentWorkflowPlanSchema.parse({
    goal,
    status: "running",
    approvalGate: { required: false },
    steps,
  });
}

function workflowContext(options: WorkflowOptions, sessionState: { user: any; viewer: any }): WorkflowExecutionContext {
  return {
    db: options.db,
    user: sessionState.user,
    workspaceId: sessionState.viewer.workspace.id,
    ...(options.jobService ? { jobService: options.jobService } : {}),
    ...(options.creditService ? { creditService: options.creditService } : {}),
    ...(options.tierGuard ? { tierGuard: options.tierGuard } : {}),
  };
}

export function registerAgentWorkflowRoutes(app: FastifyInstance, options: WorkflowOptions) {
  app.post("/api/agent/workflows", async (request: any, reply: any) => {
    try {
      const s = await session(request, reply, options);
      if (!s) return;
      const goal = typeof request.body?.goal === "string" ? request.body.goal.trim() : "";
      const idempotencyKey = typeof request.body?.idempotencyKey === "string" ? request.body.idempotencyKey.trim() : null;
      if (!goal || goal.length > 4000) return reply.code(400).send({ ok: false, error: { code: "invalid_input", message: "goal is required" } });
      if (idempotencyKey) {
        const existing = await options.db.query("select * from agent_workflow_plans where workspace_id=$1 and idempotency_key=$2", [s.viewer.workspace.id, idempotencyKey]);
        if (existing.rows[0]) return { ok: true, data: existing.rows[0] };
      }
      const media = isRecord(request.body?.media) ? request.body.media : undefined;
      const context = isRecord(request.body?.context) ? request.body.context : {};
      const plan = buildPlan(goal, media, context, request.body?.publish === true);
      const { rows } = await options.db.query(
        "insert into agent_workflow_plans(workspace_id,created_by,goal,status,plan,idempotency_key) values($1,$2,$3,'running',$4,$5) returning *",
        [s.viewer.workspace.id, s.user.id, goal, JSON.stringify(plan), idempotencyKey],
      );
      const created = rows[0];
      if (!created) return reply.code(500).send({ ok: false, error: { code: "workflow_create_failed", message: "Workflow could not be created." } });
      const progressed = await runAgentWorkflow(created.id, workflowContext(options, s));
      return reply.code(201).send({ ok: true, data: progressed });
    } catch (error) {
      return sendWorkflowError(error, reply);
    }
  });

  app.get("/api/agent/workflows/:id", async (request: any, reply: any) => {
    const s = await session(request, reply, options);
    if (!s) return;
    const { rows } = await options.db.query("select * from agent_workflow_plans where id=$1 and workspace_id=$2", [request.params.id, s.viewer.workspace.id]);
    if (!rows[0]) return reply.code(404).send({ ok: false, error: { code: "workflow_not_found", message: "Workflow not found." } });
    parseWorkflowPlan(rows[0].plan);
    return { ok: true, data: rows[0] };
  });

  app.post("/api/agent/workflows/:id/approve", async (request: any, reply: any) => {
    try {
      const s = await session(request, reply, options);
      if (!s) return;
      const current = await options.db.query("select * from agent_workflow_plans where id=$1 and workspace_id=$2", [request.params.id, s.viewer.workspace.id]);
      const row = current.rows[0];
      if (!row) return reply.code(404).send({ ok: false, error: { code: "workflow_not_found", message: "Workflow not found." } });
      const plan = parseWorkflowPlan(row.plan);
      const requestedStepId = typeof request.body?.stepId === "string" ? request.body.stepId : plan.approvalGate.stepId;
      if (row.status !== "paused" || !plan.approvalGate.required || !requestedStepId || plan.approvalGate.stepId !== requestedStepId) {
        return reply.code(409).send({ ok: false, error: { code: "workflow_not_approvable", message: "Workflow is not awaiting this approval." } });
      }
      const progressed = await runAgentWorkflow(request.params.id, workflowContext(options, s), requestedStepId);
      return { ok: true, data: progressed };
    } catch (error) {
      return sendWorkflowError(error, reply);
    }
  });

  app.post("/api/agent/workflows/:id/retry", async (request: any, reply: any) => {
    try {
      const s = await session(request, reply, options);
      if (!s) return;
      const retried = await retryAgentWorkflow(request.params.id, workflowContext(options, s));
      return { ok: true, data: retried };
    } catch (error) {
      return sendWorkflowError(error, reply);
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sendWorkflowError(error: unknown, reply: any) {
  if (error instanceof WorkflowExecutionError) {
    const status = error.code === "workflow_not_found" ? 404 : error.code === "workflow_not_retryable" || error.code === "workflow_not_approvable" ? 409 : 400;
    return reply.code(status).send({ ok: false, error: { code: error.code, message: error.message } });
  }
  throw error;
}
