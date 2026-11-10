import { projectContextSchema, type ProjectContext, type ProjectContextQuery, type ProjectContextUpdate } from "@helstera/shared";
import { getServerBaseUrl } from "./env";

export class ProjectContextRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function requestContext(token: string, method: "GET" | "PUT", query: ProjectContextQuery, input?: ProjectContextUpdate, signal?: AbortSignal): Promise<ProjectContext | null> {
  const params = new URLSearchParams(Object.entries(query).filter((entry): entry is [string,string] => typeof entry[1] === "string"));
  const response = await fetch(`${getServerBaseUrl()}/api/project-context${params.size ? `?${params}` : ""}`, {
    method, credentials: "include", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(input ? { body: JSON.stringify(input) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok) throw new ProjectContextRequestError(response.status, body.error?.message ?? "暂时无法读取工程，请重试。");
  return body.data === null ? null : projectContextSchema.parse(body.data);
}

export const fetchProjectContext = (token: string, query: ProjectContextQuery, signal?: AbortSignal) => requestContext(token,"GET",query,undefined,signal);
export const updateProjectContext = (token: string, input: ProjectContextUpdate, signal?: AbortSignal) => requestContext(token,"PUT",{},input,signal);

export function contextQuery(address: string): ProjectContextQuery {
  const url = new URL(address, "https://helstera.invalid");
  const fragment = new URLSearchParams(url.hash.slice(1));
  const projectId = url.searchParams.get("projectId") ?? fragment.get("projectId");
  const canvasId = url.searchParams.get("canvasId") ?? fragment.get("canvasId") ?? url.searchParams.get("timelineCanvas") ?? url.searchParams.get("returnCanvas") ?? (url.pathname.includes("canvas") ? url.searchParams.get("id") : url.searchParams.get("project"));
  const sessionId = url.searchParams.get("session");
  return { ...(projectId ? { projectId } : {}), ...(canvasId ? { canvasId } : {}), ...(sessionId ? { sessionId } : {}) };
}
