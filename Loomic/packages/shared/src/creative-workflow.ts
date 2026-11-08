import { z } from "zod";

export const creativeTextRole = z.enum([
  "story",
  "script",
  "character",
  "prompt",
]);
export const creativeWriteMode = z.enum(["rewrite", "script", "storyboard"]);
export const creativeAspect = z.enum(["original", "portrait", "landscape"]);
export const creativeNodeConfigs = [
  z
    .object({
      kind: z.literal("text"),
      role: creativeTextRole,
      text: z.string().max(12000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("write"),
      mode: creativeWriteMode,
      instruction: z.string().max(2000),
      shotCount: z.number().int().min(1).max(6),
    })
    .strict(),
  z
    .object({ kind: z.literal("shot"), index: z.number().int().min(1).max(6) })
    .strict(),
  z
    .object({
      kind: z.literal("generate"),
      mediaType: z.enum(["image", "video"]),
      model: z.string().max(200),
      prompt: z.string().max(4000),
      aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]),
      duration: z.number().int().min(1).max(30),
      resolution: z.enum(["480p", "720p", "768p", "1080p"]),
    })
    .strict(),
  z.object({ kind: z.literal("compose"), aspect: creativeAspect }).strict(),
  z
    .object({ kind: z.literal("frame"), at: z.number().min(0).max(7200) })
    .strict(),
] as const;
export const creativeCommands = [
  z
    .object({
      executor: z.literal("content.text"),
      role: creativeTextRole,
      text: z.string().min(1).max(12000),
    })
    .strict(),
  z
    .object({
      executor: z.literal("ai.write"),
      sources: z.array(z.string()).max(8),
      mode: creativeWriteMode,
      instruction: z.string().max(2000),
      shotCount: z.number().int().min(1).max(6),
    })
    .strict(),
  z
    .object({
      executor: z.literal("content.shot"),
      fromStep: z.string(),
      index: z.number().int().min(1).max(6),
    })
    .strict(),
  z
    .object({
      executor: z.literal("media.generate"),
      sources: z.array(z.string()).max(8),
      mediaType: z.enum(["image", "video"]),
      model: z.string().min(1).max(200),
      prompt: z.string().max(4000),
      aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]),
      duration: z.number().int().min(1).max(30),
      resolution: z.enum(["480p", "720p", "768p", "1080p"]),
    })
    .strict(),
  z
    .object({
      executor: z.literal("media.compose"),
      sources: z.array(z.string()).min(2).max(8),
      aspect: creativeAspect,
    })
    .strict(),
  z
    .object({
      executor: z.literal("media.frame"),
      fromStep: z.string(),
      at: z.number().min(0).max(7200),
    })
    .strict(),
] as const;
export const storyboardOutputSchema = z
  .object({
    title: z.string().min(1).max(200),
    shots: z
      .array(
        z
          .object({
            title: z.string().min(1).max(100),
            description: z.string().min(1).max(2000),
            dialogue: z.string().max(1000),
            duration: z.number().min(1).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
