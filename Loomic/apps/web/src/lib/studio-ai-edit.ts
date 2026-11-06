import { videoEditorPlanResponseSchema, videoEditorPlanRequestSchema, videoEditorPlanSchema, videoEditorConfirmationSchema, validateVideoEditorPlan, type VideoEditorPlanResponse, type VideoEditorPlanRequest, type VideoEditorExportReceipt } from "@helstera/shared";
import type { StudioAudio, StudioCaption, StudioCut, StudioMedia } from "./studio-cut";
import type { StudioSnapshot, StudioEdit } from "./visualforge-runtime";
import { getServerBaseUrl } from "./env";

export type StudioAiAction = { label: string; status: "ready" | "planned"; type: "cut" | "caption" | "audio" | "export" };
export type StudioAiPlan = { cut: StudioCut; targetDuration: number | null; actions: StudioAiAction[]; notices: string[]; source: "model" | "local-fallback"; summary: string; exportFormat?: "webm" | "mp4"; replaceVideo?: boolean; snapshot?: StudioSnapshot; approval?: VideoEditorPlanResponse["approval"]; commands?: VideoEditorPlanResponse["plan"] };

function requestedDuration(prompt: string): number | null {
  const match = prompt.match(/(\d+(?:\.\d+)?)\s*(?:秒|s)(?![a-z])/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function requestedFormat(prompt: string): StudioCut["format"] {
  return /竖屏|9\s*:\s*16|portrait/i.test(prompt) ? "portrait" : "landscape";
}

async function editorRequest(token: string, path: string, input: unknown): Promise<unknown> {
  try {
    const response = await fetch(`${getServerBaseUrl()}/api/video/editor/${path}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(70_000) });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("编辑服务返回了无效响应，请检查服务连接后重试。");
    const payload = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? "编辑服务暂不可用，请重试。");
    return payload;
  } catch (cause) {
    if (cause && typeof cause === "object" && "name" in cause && ["TimeoutError", "AbortError"].includes(String(cause.name))) throw new Error("编辑服务请求超时。请检查模型配置和网络后重试；时间线不会自动重复修改。");
    if (cause instanceof TypeError) throw new Error("无法连接编辑服务，请检查网络后重试。");
    throw cause;
  }
}

export async function requestStudioAiPlan(token: string, input: VideoEditorPlanRequest, snapshot: StudioSnapshot): Promise<StudioAiPlan> {
  const request = videoEditorPlanRequestSchema.parse(input);
  const payload = videoEditorPlanResponseSchema.parse(await editorRequest(token, "plan", request));
  validateVideoEditorPlan(payload.plan, request);
  if (!payload.approval) throw new Error("服务端尚未启用逐项审批，请升级服务后重试。");
  return { ...normalizeModelPlan(payload.plan, snapshot), approval: payload.approval };
}

export function normalizeModelPlan(plan: VideoEditorPlanResponse["plan"], snapshot: StudioSnapshot): StudioAiPlan {
  const cutAction = plan.actions.find((action) => action.type === "cut");
  const clips = cutAction?.clips.map(clip => ({ ...clip, id: crypto.randomUUID() })) ?? snapshot.cut?.clips ?? [{ id: "existing", name: "current-composition", duration: snapshot.duration, start: 0, end: snapshot.duration }];
  const captions: StudioCaption[] = plan.actions.filter((action): action is Extract<typeof action, { type: "caption" }> => action.type === "caption").map(({ text, startMs, endMs }) => ({ text, startMs, endMs }));
  const audio: StudioAudio[] = plan.actions.filter((action): action is Extract<typeof action, { type: "audio" }> => action.type === "audio").map(({ assetName, startMs, volume }) => ({ assetName, startMs, volume }));
  const exportAction = plan.actions.find((action) => action.type === "export");
  const actions: StudioAiAction[] = plan.actions.map(action => ({ type: action.type, status: "planned", label: action.type === "cut"
    ? `替换当前画面为${action.format === "portrait" ? "竖屏" : "横屏"}剪辑：${action.clips.map(clip => `${clip.name} ${clip.start}–${clip.end} 秒`).join("；")}`
    : action.type === "caption" ? `字幕 ${action.startMs / 1000}–${action.endMs / 1000} 秒：${action.text}`
    : action.type === "audio" ? `音乐 ${action.assetName}，${action.startMs / 1000} 秒起播，音量 ${Math.round(action.volume * 100)}%（0 积分）` : "导出 MP4 到本机（0 积分）" }));
  return { cut: { format: cutAction?.format ?? snapshot.format, clips, captions, audio }, targetDuration: clips.reduce((sum, clip) => sum + clip.end - clip.start, 0), actions,
    notices: ["字幕文案由模型生成，未经语音转写。已有音乐和本机导出为 0 积分，模型推理沿用现有 Agent 配置。"], source: "model", summary: plan.summary, snapshot, commands: plan, replaceVideo: Boolean(cutAction), ...(exportAction ? { exportFormat: exportAction.format } : {}) };
}

export async function confirmStudioPlan(token: string, plan: StudioAiPlan, confirmed: ReadonlySet<number>): Promise<StudioEdit> {
  if (!plan.approval || !plan.snapshot || !plan.commands) throw new Error("计划缺少服务端审批记录。");
  if (confirmed.size !== plan.actions.length || plan.actions.some((_, index) => !confirmed.has(index))) throw new Error("请先逐项确认计划中的动作。");
  const approved = videoEditorConfirmationSchema.parse(await editorRequest(token, `plans/${plan.approval.id}/confirm`, { revision: plan.snapshot.revision, fingerprint: plan.approval.fingerprint, actions: [...confirmed] }));
  if (approved.id !== plan.approval.id || approved.compositionId !== plan.snapshot.compositionId || JSON.stringify(approved.plan) !== JSON.stringify(videoEditorPlanSchema.parse(plan.commands))) throw new Error("服务端确认的计划与预览不一致，请重新生成并确认。");
  const normalized = normalizeModelPlan(approved.plan, plan.snapshot);
  return { id: plan.approval.id, compositionId: approved.compositionId, revision: plan.snapshot.revision, cut: normalized.cut, replaceVideo: Boolean(normalized.replaceVideo) };
}

export async function completeStudioPlan(token: string, plan: StudioAiPlan, output?: VideoEditorExportReceipt) {
  if (!plan.approval) throw new Error("缺少编辑回执标识。");
  await editorRequest(token, `plans/${plan.approval.id}/complete`, { fingerprint: plan.approval.fingerprint, ...(output ? { output } : {}) });
}

export function buildStudioAiPlan(prompt: string, media: StudioMedia[], durations: ReadonlyMap<string, number>): StudioAiPlan {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error("请输入要修改当前视频工程的目标。");
  if (media.length === 0) throw new Error("当前工程没有可用的视频素材，请先导入视频。");
  const targetDuration = requestedDuration(cleanPrompt);
  const format = requestedFormat(cleanPrompt);
  const clips: StudioCut["clips"] = [];
  let remaining = targetDuration ?? Number.POSITIVE_INFINITY;
  for (const item of media) {
    const duration = durations.get(item.name);
    if (!duration || !Number.isFinite(duration) || duration <= 0) continue;
    const end = Math.min(duration, remaining);
    if (end < 1 / 30) continue;
    clips.push({ id: crypto.randomUUID(), name: item.name, duration, start: 0, end });
    remaining -= end;
    if (remaining <= 1 / 30) break;
  }
  if (!clips.length) throw new Error("无法读取当前工程的视频时长，请重新导入素材后重试。");
  const actions: StudioAiAction[] = [{ type: "cut", label: format === "portrait" ? "切换为竖屏 9:16" : "使用横屏 16:9", status: "ready" }, { type: "cut", label: targetDuration ? `剪辑为 ${targetDuration} 秒` : "按当前素材顺序拼接视频", status: "ready" }];
  const notices: string[] = [];
  if (/字幕|caption|subtitle/i.test(cleanPrompt)) { actions.push({ type: "caption", label: "生成字幕", status: "planned" }); notices.push("字幕需要在计划确认后写入当前合成。"); }
  if (/背景音乐|配乐|音乐|music|audio/i.test(cleanPrompt)) { actions.push({ type: "audio", label: "添加背景音乐", status: "planned" }); notices.push("背景音乐只会使用当前工程中已导入的音频素材。"); }
  if (/导出|export/i.test(cleanPrompt)) actions.push({ type: "export", label: "导出视频", status: "planned" });
  return { cut: { format, clips }, targetDuration, actions, notices, source: "local-fallback", summary: "本地规则计划" };
}
