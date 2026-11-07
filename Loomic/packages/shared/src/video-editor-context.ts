import { z } from "zod";
import { motionTracksSchema } from "./video-motion.js";

export const videoLayerChangesSchema = z.strictObject({
  text: z.string().max(500).optional(),
  fontSize: z.number().finite().min(8).max(400).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  x: z.number().finite().min(-7680).max(7680).optional(),
  y: z.number().finite().min(-7680).max(7680).optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  volume: z.number().finite().min(0).max(2).optional(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().positive().optional(),
  removed: z.literal(true).optional(),
}).refine(changes => Object.keys(changes).length > 0, "请指定图层修改。");
export type VideoLayerChanges = z.infer<typeof videoLayerChangesSchema>;

export const videoLayerSchema = z.strictObject({
  id: z.string().min(1).max(80), label: z.string().max(240), kind: z.string().max(80),
  text: z.string().max(500).optional(), startMs: z.number().nonnegative(), endMs: z.number().positive(),
  editable: z.array(z.enum(["text", "fontSize", "color", "x", "y", "opacity", "volume", "startMs", "endMs", "removed"])).max(10),
  values: z.record(z.string().max(20),z.union([z.string().max(500),z.number().finite()])).refine(values=>Object.keys(values).length<=10).optional(),
  motion: motionTracksSchema.optional(),
  canAnimate: z.boolean().optional(),
});
export type VideoEditorLayer = z.infer<typeof videoLayerSchema>;

export const videoStudioControlSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("play") }),
  z.strictObject({ type: z.literal("pause") }),
  z.strictObject({ type: z.literal("seek"), seconds: z.number().finite().nonnegative().max(7200) }),
  z.strictObject({ type: z.literal("mute"), muted: z.boolean() }),
  z.strictObject({ type: z.literal("select"), compositionId: z.string().min(1).max(200) }),
  z.strictObject({ type: z.literal("export") }),
  z.strictObject({ type: z.literal("undo"), actionIndex: z.number().int().nonnegative().max(119).optional() }),
  z.strictObject({ type: z.literal("panel"), panel: z.enum(["assets", "transcript", "timeline"]) }),
]);
export type VideoStudioControl = z.infer<typeof videoStudioControlSchema>;

export const videoStudioStateSchema = z.strictObject({
  compositions: z.array(z.string().min(1).max(200)).max(200),
  currentFrame: z.number().int().nonnegative(), fps: z.number().positive().max(240),
  playing: z.boolean(), muted: z.boolean(),
  controls: z.array(z.enum(["play", "pause", "seek", "mute", "select", "export", "undo", "panel"])).max(8),
  selection: z.string().max(2000).optional(),
  undoable: z.array(z.number().int().nonnegative().max(119)).max(120),
});
export type VideoStudioState = z.infer<typeof videoStudioStateSchema>;
