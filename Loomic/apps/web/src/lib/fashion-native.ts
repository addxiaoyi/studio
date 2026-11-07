import { decodeFashionImage, type FashionInput, type FashionResult } from "./fashion-generation";

type NativeReply = { ok: boolean; image?: string; mimeType?: string; model?: string; error?: string };
type NativeApi = { fashionNative?(input: Record<string, unknown>): Promise<NativeReply> };
function nativeApi() { return (window as Window & { electronAPI?: NativeApi }).electronAPI; }
export const hasNativeFashion = () => Boolean(nativeApi()?.fashionNative);
export const pendingNativeFashion = (userId: string) => Boolean(localStorage.getItem("loomic:fashion:native:" + userId));

export async function recoverNativeFashion(userId: string, review = false): Promise<FashionResult | null> {
  const key = "loomic:fashion:native:" + userId;
  const raw = localStorage.getItem(key);
  const invoke = nativeApi()?.fashionNative;
  if (!raw || !invoke) throw new Error("请在发起任务的桌面客户端恢复试穿。");
  const requestId = JSON.parse(raw).requestId;
  const reply = await invoke({ requestId, operation: review ? "review" : "recover" });
  if (!reply.ok) throw new Error(reply.error || "本机试穿尚未完成。");
  if (review && !reply.image) { localStorage.removeItem(key); return null; }
  if (!reply.image) throw new Error("本机记录缺少试穿结果。");
  const image = decodeFashionImage(reply.image, "try-on");
  return { image: reply.image, mimeType: image.type, model: reply.model || "个人模型", assetId: "", jobId: "native:" + requestId };
}

export async function checkNativeFashion() {
  const invoke = nativeApi()?.fashionNative;
  if (!invoke) throw new Error("本机 ComfyUI 检测需要包含女装后端的桌面客户端。");
  return invoke({ operation: "health", requestId: crypto.randomUUID() });
}

export async function generateNativeFashion(input: FashionInput, userId: string): Promise<FashionResult> {
  const invoke = nativeApi()?.fashionNative;
  if (!invoke) throw new Error("个人模型与本机 ComfyUI 可在桌面客户端直接使用；网页版请在设置中填写已运行的原项目后端地址。");
  const key = "loomic:fashion:native:" + userId;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
  const fingerprint = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  const saved = localStorage.getItem(key);
  const prior = saved ? JSON.parse(saved) as { requestId: string; fingerprint: string } : null;
  if (prior && prior.fingerprint !== fingerprint) throw new Error("上次个人模型任务尚未取回，请使用相同照片与配置恢复，核实后再发起新任务。");
  const request = prior ?? { requestId: crypto.randomUUID(), fingerprint };
  localStorage.setItem(key, JSON.stringify(request));
  const reply = await invoke({ ...input, requestId: request.requestId, operation: "generate" });
  if (!reply.ok || !reply.image) {
    if (reply.error === "已取消本次试穿。") localStorage.removeItem(key);
    throw new Error(reply.error || "本机试穿未取得图像。");
  }
  const image = decodeFashionImage(reply.image, "try-on");
  // The native journal retains the completed result if browser history fails to save.
  return { image: reply.image, mimeType: image.type, model: reply.model || input.model, jobId: "native:" + request.requestId, assetId: "" };
}

export function finishNativeFashion(userId: string, jobId: string) {
  const key = "loomic:fashion:native:" + userId;
  const raw = localStorage.getItem(key);
  if (raw && "native:" + JSON.parse(raw).requestId === jobId) localStorage.removeItem(key);
}
