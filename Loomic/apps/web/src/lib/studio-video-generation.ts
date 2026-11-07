import {
  ApiApplicationError, confirmGenerationApproval, fetchGenerationApprovalStatus,
  fetchJob,
} from "./server-api";
import {submitMaterialVideo} from "./studio-material-api";

export type StudioVideoDraft = {
  prompt: string; model: string; duration: number; resolution: string; aspectRatio: string;
  requireConfirmation?:boolean;
};
export type StudioVideoApproval = {
  approvalId: string; model: string; estimatedCredits: number; expiresAt: string;
};
export type StudioVideoRequest = {
  key: string; draft: StudioVideoDraft; approval?: StudioVideoApproval; jobId?: string;
};
export type StudioVideoState = {
  phase: "draft" | "approval" | "running" | "succeeded" | "failed" | "canceled";
  request: StudioVideoRequest;
  assetId?: string;
  message?: string;
};
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const storageKey = (userId: string) => `loomic:studio-video:${userId}`;

function isApproval(value: unknown): value is StudioVideoApproval {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.approvalId === "string" && UUID.test(item.approvalId)
    && typeof item.model === "string" && typeof item.estimatedCredits === "number"
    && Number.isFinite(item.estimatedCredits) && item.estimatedCredits >= 0
    && typeof item.expiresAt === "string" && Number.isFinite(Date.parse(item.expiresAt));
}

export function readStudioVideo(userId: string): StudioVideoRequest | null {
  const raw = localStorage.getItem(storageKey(userId));
  if (!raw) return null;
  let saved: StudioVideoRequest;
  try { saved = JSON.parse(raw) as StudioVideoRequest; }
  catch { throw new Error("无法读取视频任务记录，请到活动页核实原任务。"); }
  if (!saved || !UUID.test(saved.key) || !saved.draft || typeof saved.draft.prompt !== "string"
    || typeof saved.draft.model !== "string" || !Number.isFinite(saved.draft.duration)
    || typeof saved.draft.resolution !== "string" || typeof saved.draft.aspectRatio !== "string"
    || (saved.jobId !== undefined && !UUID.test(saved.jobId))
    || (saved.approval !== undefined && !isApproval(saved.approval))) {
    throw new Error("视频任务恢复记录无效，请到活动页核实原任务。");
  }
  return saved;
}

function saveStudioVideo(userId: string, request: StudioVideoRequest) {
  // Write the stable request key before contacting the server so uncertain replies can be retried.
  localStorage.setItem(storageKey(userId), JSON.stringify(request));
}

export function createStudioVideo(userId: string, draft: StudioVideoDraft): StudioVideoRequest {
  if (readStudioVideo(userId)) throw new Error("请先处理或取回当前视频任务。");
  if (!draft.prompt.trim() || !draft.model || draft.duration <= 0) throw new Error("请补全视频描述、模型和时长。");
  const request = { key: crypto.randomUUID(), draft: { ...draft, prompt: draft.prompt.trim() } };
  saveStudioVideo(userId, request);
  return request;
}

export async function submitStudioVideo(userId: string, token: string, request: StudioVideoRequest): Promise<StudioVideoRequest> {
  if (request.jobId || request.approval) return request;
  let saved: StudioVideoRequest;
  try {
    const { job } = await submitMaterialVideo(token,request);
    if (!UUID.test(job.id)) throw new Error("服务端未返回有效任务，请恢复原请求。");
    saved = { ...request, jobId: job.id };
  } catch (cause) {
    // Only these preflight responses prove that no job was created. Billing errors can arrive after creation.
    if (cause instanceof ApiApplicationError && cause.statusCode === 422
      && ["video_model_unavailable", "invalid_input"].includes(cause.code)) {
      clearStudioVideo(userId, request.key);
    }
    if (!(cause instanceof ApiApplicationError) || cause.code !== "generation_confirmation_required") throw cause;
    if (!isApproval(cause.details)) throw new Error("费用确认信息无效，任务未启动。");
    saved = { ...request, approval: cause.details };
  }
  saveStudioVideo(userId, saved);
  return saved;
}

export async function inspectStudioVideo(token: string, original: StudioVideoRequest, signal?: AbortSignal): Promise<StudioVideoState> {
  let request = original;
  if (!request.jobId && request.approval) {
    const status = await fetchGenerationApprovalStatus(token, request.approval.approvalId);
    signal?.throwIfAborted();
    if (typeof status.jobId === "string" && UUID.test(status.jobId)) {
      request = { ...request, jobId: status.jobId };
      // Queries never write the current request slot: another tab may have started a newer task.
    } else if (["rejected", "expired"].includes(String(status.approvalStatus))) {
      return { phase: "canceled", request, message: "费用审批已取消或过期，未提交新生成任务。" };
    } else return { phase: "approval", request };
  }
  if (!request.jobId) return { phase: "draft", request };
  const { job } = await fetchJob(token, request.jobId, signal);
  if (["failed", "dead_letter", "canceled"].includes(job.status)) {
    return { phase: job.status === "canceled" ? "canceled" : "failed", request, message: job.error_message || "视频任务已结束，未生成可用视频。" };
  }
  if (job.status === "succeeded") {
    const assetId = job.result?.asset_id;
    if (typeof assetId !== "string" || !UUID.test(assetId)) throw new Error("视频已完成，但缺少有效素材标识。请在素材库核实，不要重复生成。");
    return { phase: "succeeded", request, assetId };
  }
  return { phase: "running", request, message: job.status === "queued" ? "任务已排队，可继续剪辑当前工程。" : "视频正在后台生成，可继续剪辑当前工程。" };
}

export async function approveStudioVideo(userId: string, token: string, request: StudioVideoRequest) {
  if (!request.approval) throw new Error("当前任务没有待确认的费用。");
  const { data } = await confirmGenerationApproval(token, request.approval.approvalId);
  if (!data.jobId || !UUID.test(data.jobId)) throw new Error("费用已处理，尚未取得任务编号。请恢复原任务。");
  const confirmed = { ...request, jobId: data.jobId };
  saveStudioVideo(userId, confirmed);
  return confirmed;
}

export function clearStudioVideo(userId: string, key: string) {
  if (readStudioVideo(userId)?.key === key) localStorage.removeItem(storageKey(userId));
}
