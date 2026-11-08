import {
  agentBrowserSessionsSchema,
  type AgentBrowserSession,
  type WebsiteHandoffInput,
} from "@helstera/shared";
import { getServerBaseUrl } from "./env";
import { boundedResponseBlob } from "./bounded-response-blob";

function headers(token: string) {
  return token === "local-cookie" ? {} : { Authorization: `Bearer ${token}` };
}
export class AgentBrowserAccessError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AgentBrowserAccessError";
  }
}
async function request(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(
    `${getServerBaseUrl()}/api/agent/browser/${path}`,
    {
      ...init,
      credentials: "include",
      redirect: "error",
      cache: "no-store",
      headers: { ...headers(token), ...init.headers },
    },
  );
  if (!response.ok) {
    if (response.status === 401)
      throw new AgentBrowserAccessError(
        401,
        "登录已过期，请重新登录后查看 Agent 浏览器。",
      );
    if (response.status === 403)
      throw new AgentBrowserAccessError(
        403,
        "隔离浏览器权限已关闭，请在 Agent 连接器设置中启用。",
      );
    if (response.status === 404)
      throw new Error("浏览器画面尚未生成或已过期。");
    throw new Error(
      response.status === 409
        ? "会话已结束或断线，请查看任务记录。"
        : "暂时无法连接浏览器预览，正在重试。",
    );
  }
  return response;
}
export async function listAgentBrowsers(token: string, signal: AbortSignal) {
  return agentBrowserSessionsSchema.parse(
    await (await request(token, "sessions", { signal })).json(),
  );
}
export async function readAgentBrowserFrame(
  token: string,
  session: AgentBrowserSession,
  signal: AbortSignal,
) {
  const response = await request(
    token,
    `sessions/${session.id}/frame?revision=${session.frameRevision}`,
    { signal },
  );
  if (!response.headers.get("content-type")?.startsWith("image/jpeg"))
    throw new Error("浏览器返回了无效画面。");
  return boundedResponseBlob(response, 1024 * 1024);
}
export async function controlAgentBrowser(
  token: string,
  id: string,
  control: "agent" | "paused",
) {
  await request(token, `sessions/${id}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ control }),
  });
}
export function openAgentBrowser(taskId?: string) {
  window.dispatchEvent(
    new CustomEvent("loomic:show-agent-browser", { detail: { taskId } }),
  );
}
export async function sendBrowserHandoff(token:string,session:AgentBrowserSession,input:WebsiteHandoffInput,id:string){
  return (await (await request(token,'handoff/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,viewId:session.id,frameRevision:session.frameRevision,pageUrl:session.url,input})})).json()).data as {id:string;status:string};
}
export async function readHandoffReceipt(token:string,id:string){return (await (await request(token,`handoff/receipts/${id}`)).json()).data as {id:string;status:string};}
