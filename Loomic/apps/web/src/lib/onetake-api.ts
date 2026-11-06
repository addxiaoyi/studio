import type { TranscriptTask, TranscriptSummary, TranscriptExport, TranscriptEdit, TranscriptExportOptions } from "@helstera/shared";
import { getServerBaseUrl } from "./env";
import { boundedResponseBlob } from "./bounded-response-blob";

export type OneTakeCapabilities = { available: boolean; burnSubtitles: boolean; models: string[]; reason: string; maxBytes: number; retentionDays: number; credits: number };
const endpoint = (path: string) => `${getServerBaseUrl()}/api/video/onetake/${path}`;

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(endpoint(path), { ...init, credentials: "include", redirect: "error", headers: { authorization: `Bearer ${token}`, ...(init.body != null && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...init.headers } });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("文字剪辑服务返回无效响应，请检查连接后重试。");
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "文字剪辑请求失败，请重试。");
  return payload as T;
}

export const oneTakeApi = {
  capabilities: (token: string, signal?: AbortSignal) => request<OneTakeCapabilities>(token, "capabilities", { signal: signal ?? null }),
  tasks: async (token: string, signal?: AbortSignal) => (await request<{ tasks: TranscriptSummary[] }>(token, "tasks", { signal: signal ?? null })).tasks,
  task: async (token: string, id: string, signal?: AbortSignal) => (await request<{ task: TranscriptTask }>(token, `tasks/${id}`, { signal: signal ?? null })).task,
  upload: async (token: string, file: File, key: string, model: string, language: string) => {
    const form = new FormData(); form.append("file", file);
    return (await request<{ task: TranscriptTask }>(token, `tasks?${new URLSearchParams({ consent: "1", model, language })}`, { method: "POST", body: form, headers: { "idempotency-key": key } })).task;
  },
  save: async (token: string, task: TranscriptTask, edit: TranscriptEdit) => (await request<{ task: TranscriptTask }>(token, `tasks/${task.id}/edit`, { method: "PUT", body: JSON.stringify({ revision: task.revision, edit }) })).task,
  cancel: (token: string, id: string) => request(token, `tasks/${id}/cancel`, { method: "POST" }),
  retry: (token: string, id: string) => request(token, `tasks/${id}/retry`, { method: "POST" }),
  exports: async (token: string, id: string, signal?: AbortSignal) => (await request<{ exports: TranscriptExport[] }>(token, `tasks/${id}/exports`, { signal: signal ?? null })).exports,
  prepare: async (token: string, task: TranscriptTask, options: TranscriptExportOptions, key: string) => (await request<{ export: TranscriptExport }>(token, `tasks/${task.id}/exports`, { method: "POST", body: JSON.stringify({ revision: task.revision, options, requestKey: key }) })).export,
  confirm: (token: string, output: TranscriptExport) => request(token, `exports/${output.id}/confirm`, { method: "POST", body: JSON.stringify({ fingerprint: output.fingerprint }) }),
  cancelExport: (token: string, id: string) => request(token, `exports/${id}/cancel`, { method: "POST" }),
  saveAsset: (token: string, id: string) => request<{ assetId: string }>(token, `exports/${id}/save`, { method: "POST" }),
  async media(token: string, path: string, signal?: AbortSignal) {
    const response = await fetch(endpoint(path), { headers: { authorization: `Bearer ${token}` }, credentials: "include", redirect: "error", signal: signal ?? null });
    if (!response.ok) throw new Error("素材无法读取，可能已过期或登录失效。请刷新任务后重试。");
    return boundedResponseBlob(response, 500 * 1024 * 1024);
  },
};
