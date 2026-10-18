import { z } from "zod";

export const cursorPageSchema = z.object({
  cursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1).max(64),
  title: z.string().min(1).max(160),
  body: z.string().max(2000),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const galleryAssetSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  title: z.string().min(1).max(160),
  description: z.string().max(2000),
  status: z.enum(["draft", "published", "hidden", "removed"]),
  featured: z.boolean(),
  likeCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  publishedAt: z.string().datetime().nullable(),
});

export const galleryCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  requestId: z.string().uuid(),
});

export const promptEntrySchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(160),
  prompt: z.string().min(1).max(12000),
  category: z.string().max(80),
  tags: z.array(z.string().max(40)).max(20),
  favoriteCount: z.number().int().nonnegative(),
  viewCount: z.number().int().nonnegative(),
});

export const membershipStatusSchema = z.object({
  plan: z.string().min(1).max(64),
  status: z.enum(["inactive", "active", "past_due", "cancelled", "expired"]),
  startsAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
});

export type Notification = z.infer<typeof notificationSchema>;
export type GalleryAsset = z.infer<typeof galleryAssetSchema>;
export type PromptEntry = z.infer<typeof promptEntrySchema>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const feedPlatforms = [
  "douyin",
  "xiaohongshu",
  "kuaishou",
  "zhihu",
  "bilibili",
  "wechat_channels",
  "wechat_official",
  "tiktok",
  "instagram",
  "facebook",
  "youtube",
  "pinterest",
  "x",
  "x",
] as const;

export const feedPackageStatusSchema = z.enum([
  "draft",
  "structured",
  "approved",
  "rendering",
  "failed",
  "ready",
  "scheduled",
  "exported",
  "published",
  "measured",
  "analyzed",
]);

export const feedShotSchema = z.object({
  id: z.string().min(1).max(64),
  startSecond: z.number().nonnegative(),
  endSecond: z.number().positive(),
  visual: z.string().trim().min(1).max(1200),
  voiceover: z.string().trim().max(1200),
  subtitle: z.string().trim().max(300),
});

export const feedStructureSchema = z.object({
  title: z.string().trim().min(1).max(160),
  audience: z.string().trim().min(1).max(500),
  painPoint: z.string().trim().min(1).max(500),
  angle: z.string().trim().min(1).max(500),
  hypothesis: z.string().trim().min(1).max(500),
  hook: z.string().trim().min(1).max(300),
  evidence: z.array(z.string().trim().min(1).max(300)).max(12),
  cta: z.string().trim().min(1).max(300),
  riskNotes: z.array(z.string().trim().min(1).max(300)).max(12),
  imagePrompt: z.string().trim().min(1).max(4000),
  videoPrompt: z.string().trim().min(1).max(6000),
  aspectRatio: z.string().regex(/^\d+:\d+$/).optional(),
  referenceAssetIds: z.array(z.string().uuid()).max(8).optional(),
  referenceImageUrls: z.array(z.string().trim().min(1).max(2000)).max(8).optional(),

  shots: z.array(feedShotSchema).min(1).max(30),
});

export const createFeedPackageSchema = z.object({
  title: z.string().trim().min(1).max(160),
  brief: z.string().trim().min(1).max(4000),
  topic: z.string().trim().max(500).default(""),
  goal: z.string().trim().min(1).max(120),
  contentType: z.string().trim().min(1).max(120),
  platforms: z.array(z.enum(feedPlatforms)).min(1).max(feedPlatforms.length),
  durationSeconds: z.number().int().min(5).max(300),
  workflowMode: z.enum(["review", "automatic"]),
  modelId: z.string().trim().max(160).nullable().default(null),
  estimatedCostCny: z.number().nonnegative().nullable().default(null),
  maxCostCny: z.number().positive().nullable().default(null),
  trendItemId: z.string().uuid().nullable().default(null),
  referenceAssetIds: z.array(z.string().uuid()).max(8).default([]),
  referenceImageUrls: z.array(z.string().trim().min(1).max(2000)).max(8).default([]),

});

export const feedScheduleInputSchema = z.object({
  packageId: z.string().uuid(),
  variantId: z.string().uuid().nullable().default(null),
  platform: z.enum(feedPlatforms),
  accountId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
  publishMode: z.enum(["oauth_api", "extension", "scan_confirm", "deep_link"]),
  idempotencyKey: z.string().trim().min(8).max(160),
});

export const publishingAccountInputSchema = z.object({
  platform: z.enum(feedPlatforms),
  alias: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(500).default(""),
  connectionMode: z.enum(["oauth_api", "extension", "scan_confirm", "deep_link"]),
});

export const publishingPlanActionSchema = z.object({
  action: z.enum(["confirm", "cancel", "mark_published"]),
  externalUrl: z.string().url().max(2000).optional(),
});

export const feedMetricInputSchema = z.object({
  packageId: z.string().uuid(),
  planId: z.string().uuid().nullable().optional(),
  variantId: z.string().uuid().nullable().default(null),
  platform: z.enum(feedPlatforms),
  accountAlias: z.string().trim().min(1).max(120),
  postUrl: z.string().url().max(2000),
  publishedAt: z.string().datetime(),
  impressions: z.number().int().nonnegative().default(0),
  views: z.number().int().nonnegative().default(0),
  completions: z.number().int().nonnegative().default(0),
  likes: z.number().int().nonnegative().default(0),
  comments: z.number().int().nonnegative().default(0),
  shares: z.number().int().nonnegative().default(0),
  saves: z.number().int().nonnegative().default(0),
  clicks: z.number().int().nonnegative().default(0),
  leads: z.number().int().nonnegative().default(0),
  conversions: z.number().int().nonnegative().default(0),
  spendCny: z.number().nonnegative().default(0),
  revenueCny: z.number().nonnegative().default(0),
  rawSource: z.record(z.string(), z.unknown()).optional(),
});

export type FeedPlatform = (typeof feedPlatforms)[number];
export type FeedPackageStatus = z.infer<typeof feedPackageStatusSchema>;
export type FeedStructure = z.infer<typeof feedStructureSchema>;
export type CreateFeedPackageInput = z.infer<typeof createFeedPackageSchema>;
export type FeedScheduleInput = z.infer<typeof feedScheduleInputSchema>;
export type PublishingAccountInput = z.infer<typeof publishingAccountInputSchema>;
export type FeedMetricInput = z.infer<typeof feedMetricInputSchema>;
