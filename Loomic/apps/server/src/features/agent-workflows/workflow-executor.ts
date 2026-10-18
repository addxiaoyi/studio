import type { Pool, PoolClient } from "pg";
import {
  agentWorkflowPlanSchema,
  createImageJobRequestSchema,
  createVideoJobRequestSchema,
  type AgentWorkflowPlan,
  type MediaIntent,
} from "@helstera/shared";

import type { AuthenticatedUser } from "../../auth/types.js";
import type { CreditService } from "../credits/credit-service.js";
import type { TierGuard } from "../credits/tier-guard.js";
import type { JobService } from "../jobs/job-service.js";
import { resolveConfiguredModel } from "../../http/model-availability.js";
import { buildMediaRoute } from "../media/media-routing.js";

type WorkflowRow = {
  id: string;
  workspace_id: string;
  created_by: string;
  goal: string;
  status: AgentWorkflowPlan["status"];
  plan: unknown;
  idempotency_key: string | null;
};

export type WorkflowExecutionContext = {
  db: Pool;
  user: AuthenticatedUser;
  workspaceId: string;
  jobService?: JobService;
  creditService?: CreditService;
  tierGuard?: TierGuard;
};

export class WorkflowExecutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "WorkflowExecutionError";
  }
}
type Claim =
  | { kind: "run"; row: WorkflowRow; step: AgentWorkflowPlan["steps"][number] }
  | { kind: "approval"; row: WorkflowRow }
  | { kind: "busy"; row: WorkflowRow }
  | { kind: "done"; row: WorkflowRow };

export function parseWorkflowPlan(value: unknown): AgentWorkflowPlan {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return agentWorkflowPlanSchema.parse(parsed);
}

export function findWorkflowStep(plan: AgentWorkflowPlan, stepId: string) {
  return plan.steps.find((step) => step.id === stepId) ?? null;
}

export async function runAgentWorkflow(
  workflowId: string,
  context: WorkflowExecutionContext,
  approvedStepId?: string,
) {
  for (let index = 0; index < 32; index += 1) {
    const claim = await claimNextStep(workflowId, context.db, context.workspaceId, approvedStepId);
    if (claim.kind === "done" || claim.kind === "approval" || claim.kind === "busy") return claim.row;

    try {
      const output = await executeStep(claim.step, workflowId, context);
      await completeStep(workflowId, context.db, context.workspaceId, claim.step.id, output);
    } catch (error) {
      const code = error instanceof WorkflowExecutionError ? error.code : "workflow_step_failed";
      const message = error instanceof Error ? error.message : String(error);
      await failStep(workflowId, context.db, context.workspaceId, claim.step.id, code, message);
      return loadWorkflow(workflowId, context.db, context.workspaceId);
    }
  }

  await failWorkflow(workflowId, context.db, context.workspaceId, "workflow_step_limit", "Workflow exceeded the maximum number of executable steps.");
  return loadWorkflow(workflowId, context.db, context.workspaceId);
}

export async function retryAgentWorkflow(
  workflowId: string,
  context: WorkflowExecutionContext,
) {
  const client = await context.db.connect();
  try {
    await client.query("begin");
    const row = await lockWorkflow(client, workflowId, context.workspaceId);
    if (!row) throw new WorkflowExecutionError("workflow_not_found", "Workflow not found.");
    const plan = parseWorkflowPlan(row.plan);
    const failed = plan.steps.find((step) => step.status === "failed");
    if (!failed || !failed.retryable || row.status !== "failed") {
      throw new WorkflowExecutionError("workflow_not_retryable", "Workflow has no retryable failed step.");
    }
    failed.status = "pending";
    delete failed.error;
    delete failed.output;
    plan.status = "running";
    plan.approvalGate = { required: false };
    await savePlan(client, row, plan, "running");
    await client.query("commit");
    return runAgentWorkflow(workflowId, context);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function claimNextStep(
  workflowId: string,
  db: Pool,
  workspaceId: string,
  approvedStepId?: string,
): Promise<Claim> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const row = await lockWorkflow(client, workflowId, workspaceId);
    if (!row) {
      await client.query("rollback");
      throw new WorkflowExecutionError("workflow_not_found", "Workflow not found.");
    }
    const plan = parseWorkflowPlan(row.plan);
    if (row.status === "completed" || row.status === "failed") {
      await client.query("commit");
      return { kind: "done", row };
    }

    const running = plan.steps.find((step) => step.status === "running");
    if (running) {
      await client.query("commit");
      return { kind: "busy", row };
    }

    for (const step of plan.steps) {
      if (step.status === "completed") continue;
      const dependency = step.dependsOn.find((dependencyId) => findWorkflowStep(plan, dependencyId)?.status !== "completed");
      if (dependency) {
        const dependencyStep = findWorkflowStep(plan, dependency);
        if (dependencyStep?.status === "failed") {
          plan.status = "failed";
          plan.approvalGate = { required: false };
          const failed = await savePlan(client, row, plan, "failed");
          await client.query("commit");
          return { kind: "done", row: failed };
        }
        continue;
      }

      if (step.requiresApproval && step.id !== approvedStepId) {
        step.status = "awaiting_approval";
        plan.status = "paused";
        plan.approvalGate = {
          required: true,
          stepId: step.id,
          reason: `${step.title} requires explicit confirmation before it can run.`,
        };
        const paused = await savePlan(client, row, plan, "paused");
        await client.query("commit");
        return { kind: "approval", row: paused };
      }

      step.status = "running";
      plan.status = "running";
      plan.approvalGate = { required: false };
      const runningRow = await savePlan(client, row, plan, "running");
      await client.query("commit");
      return { kind: "run", row: runningRow, step };
    }

    plan.status = "completed";
    plan.approvalGate = { required: false };
    const completed = await savePlan(client, row, plan, "completed");
    await client.query("commit");
    return { kind: "done", row: completed };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function executeStep(
  step: AgentWorkflowPlan["steps"][number],
  workflowId: string,
  context: WorkflowExecutionContext,
) {
  if (step.tool === "inspect_canvas") {
    const { rows } = await context.db.query<{ id: string; project_id: string | null; updated_at: string }>(
      `select c.id,c.project_id,c.updated_at
       from canvases c join projects p on p.id=c.project_id
       where p.workspace_id=$1 order by c.updated_at desc limit 20`,
      [context.workspaceId],
    );
    return { canvasCount: rows.length, canvasIds: rows.map((row) => row.id), latestUpdatedAt: rows[0]?.updated_at ?? null };
  }

  if (step.tool === "persist_draft") {
    return { draft: { goal: contextValue(step.input, "goal") ?? "", editable: true } };
  }

  if (step.tool === "generate_media") {
    return submitMediaJob(step.input ?? {}, workflowId, context);
  }

  if (step.tool === "publish_external") {
    throw new WorkflowExecutionError("workflow_tool_unavailable", "External publishing is not executed by Agent workflows. Prepare a reviewed draft and publish it manually.");
  }

  throw new WorkflowExecutionError("workflow_tool_unknown", `Workflow tool is not registered: ${step.tool}`);
}

async function submitMediaJob(
  input: Record<string, unknown>,
  workflowId: string,
  context: WorkflowExecutionContext,
) {
  if (!context.jobService) throw new WorkflowExecutionError("workflow_tool_unavailable", "Generation jobs are not available in this server mode.");
  const mediaType = input.mediaType === "video" ? "video" : input.mediaType === "image" ? "image" : null;
  if (!mediaType) throw new WorkflowExecutionError("invalid_media_input", "mediaType must be image or video.");

  if (mediaType === "image") {
    const payload = createImageJobRequestSchema.parse(input);
    const selected = await resolveConfiguredModel(context.db, "image", payload.model, {
      strictRequested: Boolean(payload.model),
      allowUnverified: Boolean(payload.model),
      excludeModelIds: ["nano-banana-2-1k", "nano-banana-2-2k"],
    });
    if (!selected) throw new WorkflowExecutionError(payload.model ? "model_selection_required" : "no_image_model", "No compatible image model is available.");
    const route = buildMediaRoute({
      intent: mediaIntent("image", payload),
      selected,
      candidates: [selected.model_id],
    });
    const creditsCost = await checkGenerationCost(context, selected.model_id, "image_generation", payload);
    const job = await createJob(context, "image_generation", payload, route, workflowId, creditsCost);
    return { jobId: job.id, reused: Boolean(job.reused), status: "queued", model: selected.model_id, creditsCost, routing: route };
  }

  const payload = createVideoJobRequestSchema.parse(input);
  const selected = await resolveConfiguredModel(context.db, "video", payload.model, {
    requiresInputImage: Boolean(payload.input_images?.length || payload.input_asset_ids?.length),
    strictRequested: Boolean(payload.model),
    allowUnverified: Boolean(payload.model),
    ...(payload.duration != null ? { requiredDuration: payload.duration } : {}),
  });
  if (!selected) throw new WorkflowExecutionError(payload.model ? "model_selection_required" : "no_video_model", "No compatible video model is available.");
  const route = buildMediaRoute({
    intent: mediaIntent("video", payload),
    selected,
    candidates: [selected.model_id],
  });
  const creditsCost = await checkGenerationCost(context, selected.model_id, "video_generation", payload);
  const job = await createJob(context, "video_generation", payload, route, workflowId, creditsCost);
  return { jobId: job.id, reused: Boolean(job.reused), status: "queued", model: selected.model_id, creditsCost, routing: route };
}

function mediaIntent(mediaType: "image" | "video", input: Record<string, unknown>): MediaIntent {
  const images = Array.isArray(input.input_images) ? input.input_images.length : Array.isArray(input.input_asset_ids) ? input.input_asset_ids.length : 0;
  return {
    mediaType,
    inputImageCount: images,
    inputVideo: typeof input.input_video === "string" && input.input_video.length > 0,
    enableAudio: input.enable_audio === true,
    ...(typeof input.duration === "number" ? { durationSeconds: input.duration } : {}),
    ...(typeof input.resolution === "string" ? { resolution: input.resolution } : {}),
    ...(typeof input.model === "string" ? { requestedModel: input.model } : {}),
    selectionMode: typeof input.model === "string" ? "manual" : "auto",
  };
}

async function checkGenerationCost(
  context: WorkflowExecutionContext,
  model: string,
  jobType: "image_generation" | "video_generation",
  input: Record<string, unknown>,
) {
  if (!context.tierGuard) return 0;
  await context.tierGuard.checkModelAccess(model);
  await context.tierGuard.checkConcurrency(context.workspaceId);
  return context.tierGuard.calculateCreditCost(model, jobType, {
    ...(jobType === "image_generation" ? { quality: "hd" } : {}),
    ...(typeof input.duration === "number" ? { duration: input.duration } : {}),
    ...(typeof input.resolution === "string" ? { resolution: input.resolution as never } : {}),
  });
}

async function createJob(
  context: WorkflowExecutionContext,
  jobType: "image_generation" | "video_generation",
  input: Record<string, unknown>,
  route: ReturnType<typeof buildMediaRoute>,
  workflowId: string,
  creditsCost: number,
) {
  const job = await context.jobService!.createJob(context.user, {
    workspaceId: context.workspaceId,
    ...(typeof input.project_id === "string" ? { projectId: input.project_id } : {}),
    ...(typeof input.canvas_id === "string" ? { canvasId: input.canvas_id } : {}),
    ...(typeof input.session_id === "string" ? { sessionId: input.session_id } : {}),
    ...(typeof input.thread_id === "string" ? { threadId: input.thread_id } : {}),
    idempotencyKey: `agent-workflow:${workflowId}:generate-media`,
    jobType,
    payload: { ...input, model: route.selectedModel, routing: route },
  });
  if (job.reused) return job;
  if (context.creditService && creditsCost > 0) {
    try {
      const transactionId = await context.creditService.deductCredits(context.workspaceId, context.user.id, creditsCost, job.id, `Agent workflow ${jobType}: ${route.selectedModel}`);
      await context.jobService!.setCreditsInfo(job.id, creditsCost, transactionId);
    } catch (error) {
      await context.jobService!.cancelJob(context.user, job.id).catch(() => undefined);
      throw error;
    }
  }
  return job;
}

async function completeStep(workflowId: string, db: Pool, workspaceId: string, stepId: string, output: Record<string, unknown>) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const row = await lockWorkflow(client, workflowId, workspaceId);
    if (!row) throw new WorkflowExecutionError("workflow_not_found", "Workflow not found.");
    const plan = parseWorkflowPlan(row.plan);
    const step = findWorkflowStep(plan, stepId);
    if (!step || step.status !== "running") throw new WorkflowExecutionError("workflow_step_stale", "Workflow step is no longer running.");
    step.status = "completed";
    step.output = output;
    await savePlan(client, row, plan, "running");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function failStep(workflowId: string, db: Pool, workspaceId: string, stepId: string, code: string, message: string) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const row = await lockWorkflow(client, workflowId, workspaceId);
    if (!row) throw new WorkflowExecutionError("workflow_not_found", "Workflow not found.");
    const plan = parseWorkflowPlan(row.plan);
    const step = findWorkflowStep(plan, stepId);
    if (step) {
      step.status = "failed";
      step.error = `${code}: ${message}`;
    }
    plan.status = "failed";
    plan.approvalGate = { required: false };
    await savePlan(client, row, plan, "failed");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function failWorkflow(workflowId: string, db: Pool, workspaceId: string, code: string, message: string) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const row = await lockWorkflow(client, workflowId, workspaceId);
    if (!row) return;
    const plan = parseWorkflowPlan(row.plan);
    plan.status = "failed";
    plan.approvalGate = { required: false };
    const step = plan.steps.find((item) => item.status === "running");
    if (step) {
      step.status = "failed";
      step.error = `${code}: ${message}`;
    }
    await savePlan(client, row, plan, "failed");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function loadWorkflow(workflowId: string, db: Pool, workspaceId: string) {
  const { rows } = await db.query("select * from agent_workflow_plans where id=$1 and workspace_id=$2", [workflowId, workspaceId]);
  if (!rows[0]) throw new WorkflowExecutionError("workflow_not_found", "Workflow not found.");
  return rows[0] as WorkflowRow;
}

async function lockWorkflow(client: Pick<PoolClient, "query">, workflowId: string, workspaceId: string) {
  const { rows } = await client.query("select * from agent_workflow_plans where id=$1 and workspace_id=$2 for update", [workflowId, workspaceId]);
  return (rows[0] as WorkflowRow | undefined) ?? null;
}

async function savePlan(client: Pick<PoolClient, "query">, row: WorkflowRow, plan: AgentWorkflowPlan, status: AgentWorkflowPlan["status"]) {
  const { rows } = await client.query(
    "update agent_workflow_plans set status=$1, plan=$2::jsonb, updated_at=now() where id=$3 and workspace_id=$4 returning *",
    [status, JSON.stringify(plan), row.id, row.workspace_id],
  );
  return rows[0] as WorkflowRow;
}

function contextValue(input: Record<string, unknown> | undefined, key: string) {
  const value = input?.[key];
  return typeof value === "string" ? value : null;
}
