import { z } from "zod";
import { videoEditorPlanRequestSchema, videoEditorPlanResponseSchema, videoEditorPlanSchema } from "./video-editor-contracts.js";
import { videoStudioControlSchema, videoStudioStateSchema } from "./video-editor-context.js";

export const videoChatMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]), content: z.string().min(1).max(6000),
});
export const videoChatRequestSchema = videoEditorPlanRequestSchema.extend({
  history: z.array(videoChatMessageSchema).max(30),
  studio: videoStudioStateSchema,
  pendingPlan: videoEditorPlanSchema.optional(),
  locale: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
});
export const videoChatReplySchema = z.strictObject({
  message: z.string().trim().min(1).max(6000),
  plan: videoEditorPlanSchema.optional(),
  control: videoStudioControlSchema.optional(),
}).refine(reply => !(reply.plan && reply.control), "一次回复只执行一个阶段。");
export const videoChatResponseSchema = z.object({
  source: z.literal("model"), model: z.string(), reply: videoChatReplySchema,
  approval: videoEditorPlanResponseSchema.shape.approval,
});
export type VideoChatRequest = z.infer<typeof videoChatRequestSchema>;
export type VideoChatResponse = z.infer<typeof videoChatResponseSchema>;
export type VideoChatMessage = z.infer<typeof videoChatMessageSchema>;

export function validateStudioControl(control: z.infer<typeof videoStudioControlSchema>, request: VideoChatRequest) {
  if (!request.studio.controls.includes(control.type)) throw new Error("当前编辑器不支持此操作。");
  if (control.type === "select" && !request.studio.compositions.includes(control.compositionId)) throw new Error("目标合成不存在。");
  if (control.type === "seek" && control.seconds >= (request.compositionDuration ?? 0)) throw new Error("播放位置超出视频时长。");
  if (control.type === "undo" && (!request.studio.undoable.length || control.actionIndex !== undefined && !request.studio.undoable.includes(control.actionIndex))) throw new Error("该修改已无法自动撤销。");
}
