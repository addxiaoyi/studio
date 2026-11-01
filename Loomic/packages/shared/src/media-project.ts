import { z } from "zod";

export const recorderSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("screen"), displayId: z.string().min(1) }),
  z.object({ kind: z.literal("window"), windowId: z.string().min(1) }),
  z.object({
    kind: z.literal("region"),
    displayId: z.string().min(1),
    rect: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  }),
]);

export const recorderAudioSchema = z.object({
  system: z.boolean(),
  microphoneId: z.string().min(1).optional(),
});

export const recorderSessionStateSchema = z.enum([
  "starting",
  "recording",
  "paused",
  "stopping",
  "complete",
  "failed",
]);

export const recorderSessionSchema = z.object({
  sessionId: z.string().uuid(),
  source: recorderSourceSchema,
  audio: recorderAudioSchema,
  state: recorderSessionStateSchema,
  mimeType: z.string().min(1),
  startedAt: z.string().datetime(),
  stoppedAt: z.string().datetime().optional(),
  outputPath: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

export const videoAssetSchema = z.object({
  assetId: z.string().uuid(),
  path: z.string().min(1),
  mimeType: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sampleRate: z.number().int().positive().optional(),
});

const timelineRangeSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
}).refine((range) => range.endMs > range.startMs, {
  message: "Timeline range must have a positive duration.",
});

const timelineActionUnionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trim"), clipId: z.string().min(1), range: timelineRangeSchema }),
  z.object({ type: z.literal("cut"), clipId: z.string().min(1), range: timelineRangeSchema }),
  z.object({ type: z.literal("speed"), clipId: z.string().min(1), factor: z.number().finite().positive() }),
  z.object({ type: z.literal("caption"), text: z.string().min(1), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }),
  z.object({ type: z.literal("audio"), assetId: z.string().uuid(), startMs: z.number().int().nonnegative(), volume: z.number().finite().min(0).max(2) }),
]);

export const timelineActionSchema = timelineActionUnionSchema.superRefine((action, context) => {
  if (action.type === "caption" && action.endMs <= action.startMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Caption range must have a positive duration.", path: ["endMs"] });
  }
});

export const timelineClipSchema = z.object({
  clipId: z.string().min(1),
  assetId: z.string().uuid(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  track: z.number().int().nonnegative(),
}).refine((clip) => clip.endMs > clip.startMs, {
  message: "Timeline clip must have a positive duration.",
});

export const videoProjectSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1),
  assets: z.array(videoAssetSchema),
  clips: z.array(timelineClipSchema),
  actions: z.array(timelineActionSchema),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

export type RecorderSource = z.infer<typeof recorderSourceSchema>;
export type RecorderAudio = z.infer<typeof recorderAudioSchema>;
export type RecorderSessionState = z.infer<typeof recorderSessionStateSchema>;
export type RecorderSession = z.infer<typeof recorderSessionSchema>;
export type VideoAsset = z.infer<typeof videoAssetSchema>;
export type TimelineRange = z.infer<typeof timelineRangeSchema>;
export type TimelineAction = z.infer<typeof timelineActionSchema>;
export type TimelineClip = z.infer<typeof timelineClipSchema>;
export type VideoProject = z.infer<typeof videoProjectSchema>;
