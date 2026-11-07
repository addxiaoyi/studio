import { videoChatResponseSchema, videoChatRequestSchema, type VideoChatRequest, type VideoStudioControl } from "@helstera/shared";
import { getServerBaseUrl } from "./env";
import type { StudioAiPlan } from "./studio-ai-edit";

export type StudioChatTurn = {id:string;role:"user"|"assistant";content:string;compositionId:string;createdAt:number;planId?:string;status?:"pending"|"applied"|"undone"|"superseded"|"failed";control?:VideoStudioControl;revision?:string};
export type StudioConversation = {turns:StudioChatTurn[];draft:string};
export async function requestStudioChat(token:string,input:VideoChatRequest,signal:AbortSignal){
  const response=await fetch(`${getServerBaseUrl()}/api/video/editor/chat`,{method:"POST",credentials:"include",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(videoChatRequestSchema.parse(input)),signal:AbortSignal.any([signal,AbortSignal.timeout(70000)])});
  if(!response.headers.get("content-type")?.includes("application/json"))throw new Error("对话服务不可用，请刷新后重试。");
  const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??"AI 暂时无法回复。视频尚未修改。");
  return videoChatResponseSchema.parse(payload);
}
export function chatHistory(turns:StudioChatTurn[],compositionId:string,plan:StudioAiPlan|null,applied:string|null,undone:number[]) {
  return turns.filter(turn=>turn.compositionId===compositionId).slice(-24).map(turn=>({role:turn.role,content:[turn.content,turn.planId?`方案状态：${turn.planId===plan?.approval?.id?applied?`已应用，已撤销动作序号：${undone.join(",")||"无"}`:"未执行":turn.status??"历史方案，不得重放"}`:""].filter(Boolean).join("\n").slice(0,6000)}));
}
