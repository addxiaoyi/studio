import { z } from "zod";

export const websiteCaptureModeSchema = z.enum(["isolated", "local"]);

export const websiteCaptureStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);

export const websiteCapturePageSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  description: z.string(),
  headings: z.array(z.string()),
  navigation: z.array(z.string()),
  assetId: z.string().uuid(),
  screenshotUrl: z.string(),
});

export const websiteCaptureResultSchema = z.object({
  title: z.string(),
  introduction: z.string(),
  startUrl: z.string().url(),
  pages: z.array(websiteCapturePageSchema),
  recordingAssetId: z.string().uuid().optional(),
  recordingUrl: z.string().optional(),
  completedAt: z.string(),
});

export const createWebsiteCaptureRequestSchema = z.object({
  url: z.string().trim().url().max(2048),
  mode: websiteCaptureModeSchema,
  sessionId: z.string().uuid().optional(),
  pageLimit: z.number().int().min(1).max(5).default(3),
  recordVideo: z.boolean().default(true),
  idempotencyKey: z.string().trim().min(1).max(160),
});

export const websiteCaptureTaskSchema = z.object({
  id: z.string().uuid(),
  backgroundJobId: z.string().uuid().nullable().optional(),
  status: websiteCaptureStatusSchema,
  mode: websiteCaptureModeSchema,
  startUrl: z.string().url(),
  progress: z.number().int().min(0).max(100),
  stage: z.string(),
  result: websiteCaptureResultSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type WebsiteCaptureMode = z.infer<typeof websiteCaptureModeSchema>;
export type WebsiteCaptureStatus = z.infer<typeof websiteCaptureStatusSchema>;
export type WebsiteCapturePage = z.infer<typeof websiteCapturePageSchema>;
export type WebsiteCaptureResult = z.infer<typeof websiteCaptureResultSchema>;
export type CreateWebsiteCaptureRequest = z.infer<typeof createWebsiteCaptureRequestSchema>;
export type WebsiteCaptureTask = z.infer<typeof websiteCaptureTaskSchema>;
