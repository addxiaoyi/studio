import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

const executor = vi.hoisted(() => ({
  parseWorkflowPlan: vi.fn((value: unknown) => value),
  retryAgentWorkflow: vi.fn(),
  runAgentWorkflow: vi.fn(),
}));

vi.mock("../features/agent-workflows/workflow-executor.js", () => ({
  parseWorkflowPlan: executor.parseWorkflowPlan,
  retryAgentWorkflow: executor.retryAgentWorkflow,
  runAgentWorkflow: executor.runAgentWorkflow,
  WorkflowExecutionError: class WorkflowExecutionError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { registerAgentWorkflowRoutes } from "./agent-workflows.js";

const apps: Array<ReturnType<typeof Fastify>> = [];
const user = { id: "user-1", accessToken: "token", email: "user@example.com", userMetadata: {} };
const sessionViewer = { workspace: { id: "workspace-1" } };

function workflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "workflow-1",
    workspace_id: "workspace-1",
    created_by: "user-1",
    goal: "Generate a launch image",
    status: "running",
    plan: {
      goal: "Generate a launch image",
      status: "running",
      approvalGate: { required: false },
      steps: [
        { id: "inspect", tool: "inspect_canvas", title: "Inspect", status: "completed", dependsOn: [], retryable: true, requiresApproval: false },
        { id: "draft", tool: "persist_draft", title: "Draft", status: "completed", dependsOn: ["inspect"], retryable: true, requiresApproval: false },
      ],
    },
    idempotency_key: "workflow-key",
    ...overrides,
  };
}

function createApp(query: ReturnType<typeof vi.fn>) {
  const app = Fastify();
  apps.push(app);
  registerAgentWorkflowRoutes(app, {
    db: { query } as unknown as Pool,
    auth: { authenticate: vi.fn().mockResolvedValue(user) },
    viewerService: { ensureViewer: vi.fn().mockResolvedValue(sessionViewer) } as never,
  });
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  executor.parseWorkflowPlan.mockImplementation((value: unknown) => value);
  executor.retryAgentWorkflow.mockReset();
  executor.runAgentWorkflow.mockReset();
});

describe("agent workflow routes", () => {
  it("returns the existing workflow for a repeated idempotency key without inserting again", async () => {
    const created = workflowRow();
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [created] })
      .mockResolvedValueOnce({ rows: [created] });
    executor.runAgentWorkflow.mockResolvedValue(created);
    const app = createApp(query);

    const first = await app.inject({ method: "POST", url: "/api/agent/workflows", payload: { goal: created.goal, idempotencyKey: created.idempotency_key } });
    const second = await app.inject({ method: "POST", url: "/api/agent/workflows", payload: { goal: created.goal, idempotencyKey: created.idempotency_key } });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(executor.runAgentWorkflow).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith("insert into agent_workflow_plans")).length).toBe(1);
  });

  it("requires the exact approval gate step before continuing a paused workflow", async () => {
    const paused = workflowRow({
      status: "paused",
      plan: {
        ...workflowRow().plan,
        status: "paused",
        approvalGate: { required: true, stepId: "generate", reason: "Generation requires confirmation." },
        steps: [{ id: "generate", tool: "generate_media", title: "Generate", status: "awaiting_approval", dependsOn: [], retryable: true, requiresApproval: true }],
      },
    });
    const resumed = workflowRow({ status: "running" });
    const query = vi.fn().mockResolvedValue({ rows: [paused] });
    executor.runAgentWorkflow.mockResolvedValue(resumed);
    const app = createApp(query);

    const invalid = await app.inject({ method: "POST", url: "/api/agent/workflows/workflow-1/approve", payload: { stepId: "draft" } });
    const approved = await app.inject({ method: "POST", url: "/api/agent/workflows/workflow-1/approve", payload: { stepId: "generate" } });

    expect(invalid.statusCode).toBe(409);
    expect(approved.statusCode).toBe(200);
    expect(executor.runAgentWorkflow).toHaveBeenCalledWith("workflow-1", expect.objectContaining({ workspaceId: "workspace-1" }), "generate");
  });

  it("delegates failed-step retry while preserving workspace scope", async () => {
    const retried = workflowRow({ status: "running" });
    const query = vi.fn();
    executor.retryAgentWorkflow.mockResolvedValue(retried);
    const app = createApp(query);

    const response = await app.inject({ method: "POST", url: "/api/agent/workflows/workflow-1/retry", payload: {} });

    expect(response.statusCode).toBe(200);
    expect(executor.retryAgentWorkflow).toHaveBeenCalledWith("workflow-1", expect.objectContaining({ workspaceId: "workspace-1", user }));
  });

  it("rejects unauthenticated requests before querying workflow state", async () => {
    const query = vi.fn();
    const app = Fastify();
    apps.push(app);
    registerAgentWorkflowRoutes(app, {
      db: { query } as unknown as Pool,
      auth: { authenticate: vi.fn().mockResolvedValue(null) },
      viewerService: { ensureViewer: vi.fn() } as never,
    });

    const response = await app.inject({ method: "GET", url: "/api/agent/workflows/workflow-1" });

    expect(response.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
