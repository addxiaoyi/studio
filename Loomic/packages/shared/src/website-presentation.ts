import { z } from "zod";

export const websitePresentationSchema = z
  .object({
    style: z.literal("cursor-rebuild"),
    durationSeconds: z.number().int().min(12).max(60).default(24),
    cursorCount: z.number().int().min(2).max(6).default(4),
  })
  .strict();
export type WebsitePresentation = z.infer<typeof websitePresentationSchema>;
