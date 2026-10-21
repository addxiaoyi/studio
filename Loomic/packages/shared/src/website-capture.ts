import { z } from "zod";

export const websiteCaptureModeSchema = z.enum(["isolated", "local"]);
export const websiteCapturePromoSchema = z.object({
  enabled: z.boolean().default(false),
  durationSeconds: z.number().int().min(5).max(30).default(30),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  narrationLanguage: z.enum(["zh-CN", "none"]).default("zh-CN"),
  model: z.string().trim().min(1).max(160).optional(),
});

export const websiteCaptureStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);
export const websiteCapturePromoStatusSchema = z.enum(["not_requested", "awaiting_approval", "queued", "running", "succeeded", "failed", "rejected"]);

export const websiteCaptureAssistantConnectionSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["connected", "paused", "disconnected", "revoked"]),
  browser: z.enum(["chrome", "edge", "unknown"]),
  platform: z.enum(["windows", "macos", "linux", "unknown"]),
  connectedAt: z.string(),
  lastSeenAt: z.string(),
  paused: z.boolean(),
});

export const websiteCapturePairingSchema = z.object({
  pairingId: z.string().uuid(),
  code: z.string().min(16).optional(),
  expiresAt: z.string(),
  wssUrl: z.string().url(),
  disclosure: z.string(),
});

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
  promoVideoUrl: z.string().optional(),
  promoAssetId: z.string().uuid().optional(),
});

export const createWebsiteCaptureRequestSchema = z.object({
  url: z.string().trim().url().max(2048),
  mode: websiteCaptureModeSchema,
  sessionId: z.string().uuid().optional(),
  pageLimit: z.number().int().min(1).max(5).default(3),
  recordVideo: z.boolean().default(true),
  followExternal: z.boolean().default(false),
  promo: websiteCapturePromoSchema.optional(),
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
  promoStatus: websiteCapturePromoStatusSchema.optional(),
  promo: websiteCapturePromoSchema.nullable().optional(),
  promoApprovalId: z.string().uuid().nullable().optional(),
  promoJobId: z.string().uuid().nullable().optional(),
  promoVideoUrl: z.string().nullable().optional(),
  promoError: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type WebsiteCaptureMode = z.infer<typeof websiteCaptureModeSchema>;
export type WebsiteCapturePromo = z.infer<typeof websiteCapturePromoSchema>;
export type WebsiteCaptureStatus = z.infer<typeof websiteCaptureStatusSchema>;
export type WebsiteCapturePromoStatus = z.infer<typeof websiteCapturePromoStatusSchema>;
export type WebsiteCaptureAssistantConnection = z.infer<typeof websiteCaptureAssistantConnectionSchema>;
export type WebsiteCapturePairing = z.infer<typeof websiteCapturePairingSchema>;
export type WebsiteCapturePage = z.infer<typeof websiteCapturePageSchema>;
export type WebsiteCaptureResult = z.infer<typeof websiteCaptureResultSchema>;
export type CreateWebsiteCaptureRequest = z.infer<typeof createWebsiteCaptureRequestSchema>;
export type WebsiteCaptureTask = z.infer<typeof websiteCaptureTaskSchema>;

export type WebsiteActionKind = "navigate" | "scroll" | "click" | "fill" | "upload" | "download" | "submit" | "publish" | "purchase" | "payment" | "authorize";
export type WebsiteActionRequest = {
  kind: WebsiteActionKind;
  target?: string;
  targetUrl?: string;
  targetRole?: string;
  sideEffect?: boolean;
  fieldType?: string;
  value?: string;
  top?: number;
};
