import {
  workflowDocumentSchema,
  workflowGraphSchema,
  type WorkflowGraph,
} from "@helstera/shared";
import { getServerBaseUrl } from "./env";

async function workflowRequest(
  token: string,
  canvasId: string,
  suffix: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/canvases/${encodeURIComponent(canvasId)}/workflows${suffix}`,
    {
      method,
      credentials: "include",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(125_000),
    },
  );
  const reply = (await response.json()) as {
    ok: boolean;
    data?: unknown;
    error?: { message?: string };
  };
  if (!response.ok || !reply.ok)
    throw new Error(reply.error?.message ?? "工作流服务暂不可用，请重试。");
  return reply.data;
}
export async function listCanvasWorkflows(token: string, canvasId: string) {
  const reply = (await workflowRequest(token, canvasId, "")) as {
    workflows: unknown;
    executionEnabled: boolean;
  };
  return {
    workflows: workflowDocumentSchema.array().parse(reply.workflows),
    executionEnabled: reply.executionEnabled === true,
  };
}
export async function createCanvasWorkflow(
  token: string,
  canvasId: string,
  graph: WorkflowGraph,
  requestKey: string,
) {
  return workflowDocumentSchema.parse(
    await workflowRequest(token, canvasId, "", "POST", { graph, requestKey }),
  );
}
export async function saveCanvasWorkflow(
  token: string,
  canvasId: string,
  id: string,
  revision: number,
  graph: WorkflowGraph,
) {
  return workflowDocumentSchema.parse(
    await workflowRequest(token, canvasId, `/${id}`, "PUT", {
      revision,
      graph,
    }),
  );
}
export async function planCanvasWorkflow(
  token: string,
  canvasId: string,
  prompt: string,
  graph?: WorkflowGraph,
) {
  const reply = (await workflowRequest(token, canvasId, "/plan", "POST", {
    prompt,
    ...(graph ? { graph } : {}),
  })) as { graph: unknown; summary: string };
  return {
    graph: workflowGraphSchema.parse(reply.graph),
    summary: reply.summary,
  };
}
export async function runCanvasWorkflow(
  token: string,
  canvasId: string,
  id: string,
  revision: number,
  requestKey: string,
  sessionId?: string,
) {
  return (await workflowRequest(token, canvasId, `/${id}/run`, "POST", {
    revision,
    requestKey,
    ...(sessionId ? { sessionId } : {}),
  })) as { goalId: string; reused: boolean };
}
export function openCanvasWorkflow(id?: string) {
  window.dispatchEvent(
    new CustomEvent("loomic:workflow-open", { detail: { id } }),
  );
}
export async function fetchWorkflowRuns(
  token: string,
  canvasId: string,
  id: string,
) {
  return (await workflowRequest(token, canvasId, `/${id}/runs`)) as Array<{
    id: string;
    goalId: string;
    revision: number;
    status: string;
    createdAt: string;
  }>;
}
