import { z } from "zod";
import { videoEditorPlanRequestSchema, videoEditorPlanResponseSchema, videoEditorPlanSchema } from "./video-editor-contracts.js";
import { videoStudioControlSchema, videoStudioStateSchema } from "./video-editor-context.js";
export const videoMaterialRequestSchema=z.discriminatedUnion("type",[
  z.strictObject({type:z.literal("library"),query:z.string().max(160).default(""),mediaType:z.enum(["image","video"]).optional()}),
  z.strictObject({type:z.literal("generate"),prompt:z.string().trim().min(1).max(4000),duration:z.number().int().min(1).max(60).optional(),aspectRatio:z.enum(["16:9","9:16"]).optional()}),
  z.strictObject({type:z.literal("narration"),text:z.string().trim().min(1).max(2000),voice:z.enum(['cmn','en-us']).default('cmn'),rate:z.number().int().min(100).max(220).default(150)}),
]);
export type VideoMaterialRequest=z.infer<typeof videoMaterialRequestSchema>;

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
  material:videoMaterialRequestSchema.optional(),
}).refine(reply => [reply.plan,reply.control,reply.material].filter(Boolean).length<=1, "一次回复只执行一个阶段。");
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
