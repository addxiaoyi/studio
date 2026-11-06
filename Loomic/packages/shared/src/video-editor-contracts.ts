import { z } from "zod";

const videoEditorClipSchema = z.strictObject({
  name: z.string().min(1).max(240),
  duration: z.number().finite().positive(),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
});

export const videoEditorPlanRequestSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(4_000),
  projectId: z.string().trim().min(1).max(200),
  compositionId: z.string().trim().min(1).max(200).optional(),
  revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  compositionDuration: z.number().finite().positive().max(7200).optional(),
  music: z.strictObject({ assetName: z.string().min(1).max(240), startMs: z.number().int().nonnegative(), volume: z.number().finite().min(0).max(2) }).optional(),
  captions: z.array(z.strictObject({ text: z.string().max(500), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() })).max(100).optional(),
  media: z.array(z.strictObject({
    name: z.string().min(1).max(240),
    mimeType: z.enum(["video/mp4", "video/webm", "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4"]),
    duration: z.number().finite().positive().max(7200),
  })).max(100),
});

export const videoEditorCaptionActionSchema = z.strictObject({
  type: z.literal("caption"),
  text: z.string().trim().min(1).max(500),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
});

export const videoEditorAudioActionSchema = z.strictObject({
  type: z.literal("audio"),
  assetName: z.string().min(1).max(240),
  startMs: z.number().int().nonnegative(),
  volume: z.number().finite().min(0).max(2),
});

export const videoEditorActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("cut"), format: z.enum(["portrait", "landscape"]), clips: z.array(videoEditorClipSchema).min(1).max(20) }),
  videoEditorCaptionActionSchema,
  videoEditorAudioActionSchema,
  z.strictObject({ type: z.literal("export"), format: z.literal("mp4").default("mp4") }),
]);

export const videoEditorPlanSchema = z.strictObject({
  summary: z.string().trim().min(1).max(1_000),
  actions: z.array(videoEditorActionSchema).min(1).max(120),
});

export const videoEditorPlanResponseSchema = z.object({
  source: z.literal("model"),
  model: z.string().min(1),
  plan: videoEditorPlanSchema,
  approval: z.object({ id: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.string(), estimatedCredits: z.literal(0) }).optional(),
});

export const videoEditorConfirmationSchema = z.object({ id: z.string().uuid(), compositionId: z.string().min(1), plan: videoEditorPlanSchema });
export const videoEditorExportReceiptSchema = z.strictObject({
  previewId: z.string().uuid(),
  name: z.string().min(1).max(240).refine(isVideoReceiptName, "导出文件名无效。"),
});
export type VideoEditorExportReceipt = z.infer<typeof videoEditorExportReceiptSchema>;

export type VideoEditorPlanRequest = z.infer<typeof videoEditorPlanRequestSchema>;
export type VideoEditorAction = z.infer<typeof videoEditorActionSchema>;
export type VideoEditorPlan = z.infer<typeof videoEditorPlanSchema>;
export type VideoEditorPlanResponse = z.infer<typeof videoEditorPlanResponseSchema>;

export function validateVideoEditorPlan(plan: VideoEditorPlan, input: VideoEditorPlanRequest): void {
  const media = new Map(input.media.map(item => [item.name, item]));
  if (media.size !== input.media.length) throw new Error("素材名称重复，请重新导入。");
  const cuts = plan.actions.filter(action => action.type === "cut");
  if (cuts.length > 1) throw new Error("一次计划只能包含一个剪辑方案。");
  const duration = cuts[0]?.clips.reduce((sum, clip) => sum + clip.end - clip.start, 0) ?? input.compositionDuration;
  if (!duration || duration > 7200) throw new Error("计划缺少有效的当前合成时长。");
  if (plan.actions.filter(action => action.type === "audio").length > 8 || plan.actions.filter(action => action.type === "caption").length > 100) throw new Error("字幕或音轨数量超出限制。");
  if (input.music) {
    const audio = plan.actions.filter(action => action.type === "audio");
    const selected = audio[0];
    if (audio.length !== 1 || !selected || selected.assetName !== input.music.assetName || selected.startMs !== input.music.startMs || selected.volume !== input.music.volume) throw new Error("计划改变了已选择的音乐、起播时间或音量，请重新生成。");
  }
  for (const action of plan.actions) {
    if (action.type === "cut") for (const clip of action.clips) {
      const asset = media.get(clip.name);
      if (!asset?.mimeType.startsWith("video/") || clip.end - clip.start < 1 / 30 || clip.end > asset.duration || Math.abs(clip.duration - asset.duration) > 0.001) throw new Error("剪辑引用了错误的素材类型或超出了真实时长。");
    }
    if (action.type === "caption" && (action.endMs <= action.startMs || action.endMs > Math.round(duration * 1000))) throw new Error("字幕超出了当前时间线。");
    if (action.type === "audio" && (!media.get(action.assetName)?.mimeType.startsWith("audio/") || action.startMs >= duration * 1000)) throw new Error("音乐引用了错误的素材类型或起播时间。");
  }
}

function isVideoReceiptName(name: string): boolean {
  return name.toLowerCase().endsWith(".mp4") && !name.includes("\\") && !name.includes("/") && ![...name].some(character => character.charCodeAt(0) < 32);
}
