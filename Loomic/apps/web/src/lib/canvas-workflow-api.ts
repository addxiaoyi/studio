import {
  workflowDocumentSchema,
  workflowGraphSchema,
  creativeLibraryEntrySchema,
  workflowNodeSchema,
  type CreativeLibraryBody,
  type WorkflowGraph,
  workflowProposalSchema,
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
  referenceElementIds?: string[],
) {
  const reply = (await workflowRequest(token, canvasId, "/plan", "POST", {
    prompt,
    ...(graph ? { graph } : {}),
    ...(referenceElementIds?.length ? {referenceElementIds} : {}),
  })) as { graph: unknown; summary: string };
  return {
    graph: workflowGraphSchema.parse(reply.graph),
    summary: reply.summary,
  };
}

export async function listCreativeLibrary(token:string,canvasId:string){return creativeLibraryEntrySchema.array().parse(await workflowRequest(token,canvasId,"/library"));}
export async function saveCreativeLibrary(token:string,canvasId:string,input:{name:string;description:string;body:CreativeLibraryBody;requestKey:string}){return creativeLibraryEntrySchema.parse(await workflowRequest(token,canvasId,"/library","POST",input));}
export async function archiveCreativeLibrary(token:string,canvasId:string,id:string,restore=false){await workflowRequest(token,canvasId,`/library/${id}${restore?"/restore":""}`,restore?"POST":"DELETE");}
export type WorkflowResultRun={goalId:string;revision:number;createdAt:string;status:string;results:Array<{nodeId:string;title:string;text:string;assets:Array<{id:string;mediaType:"image"|"video";available:boolean}>;config:Record<string,unknown>|null}>};
export async function fetchWorkflowResults(token:string,canvasId:string,workflowId:string,goalId:string){return await workflowRequest(token,canvasId,`/${workflowId}/runs/${goalId}/results`) as WorkflowResultRun;}
export async function reuseWorkflowOutput(token:string,canvasId:string,workflowId:string,input:{goalId:string;nodeId:string;assetId?:string}){return workflowNodeSchema.parse(await workflowRequest(token,canvasId,`/${workflowId}/reuse`,"POST",input));}
export async function runCanvasWorkflow(
  token: string,
  canvasId: string,
  id: string,
  revision: number,
  requestKey: string,
  sessionId?: string,
  targetNodeId?: string,
) {
  return (await workflowRequest(token, canvasId, `/${id}/run`, "POST", {
    revision,
    requestKey,
    ...(sessionId ? { sessionId } : {}),
    ...(targetNodeId ? { targetNodeId } : {}),
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
    graph: WorkflowGraph;
    targetNodeId: string | null;
  }>;
}
export async function listWorkflowProposals(token:string,canvasId:string,workflowId?:string){return workflowProposalSchema.array().parse(await workflowRequest(token,canvasId,`/assistant${workflowId?`?workflowId=${encodeURIComponent(workflowId)}`:""}`));}
export async function askWorkflowAssistant(token:string,canvasId:string,input:{prompt:string;requestKey:string;workflowId?:string;sessionId?:string;selectedNodeIds?:string[];referenceElementIds?:string[]}){return workflowProposalSchema.parse(await workflowRequest(token,canvasId,"/assistant","POST",input));}
export async function getWorkflowProposal(token:string,canvasId:string,id:string){return workflowProposalSchema.parse(await workflowRequest(token,canvasId,`/assistant/${id}`));}
export async function decideWorkflowProposal(token:string,canvasId:string,id:string,decision:"confirm"|"reject"){return workflowProposalSchema.parse(await workflowRequest(token,canvasId,`/assistant/${id}/${decision}`,"POST",{}));}
export function notifyWorkflowChanged(id:string,goalId?:string){window.dispatchEvent(new CustomEvent("loomic:workflow-changed",{detail:{id,goalId}}));}
