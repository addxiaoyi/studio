import { z } from "zod";

export const mediaIntentSchema = z.object({
  mediaType: z.enum(["image", "video"]),
  inputImageCount: z.number().int().min(0).max(8).default(0),
  inputVideo: z.boolean().default(false),
  enableAudio: z.boolean().default(false),
  durationSeconds: z.number().int().min(1).max(300).optional(),
  resolution: z.string().max(32).optional(),
  requestedModel: z.string().trim().max(160).optional(),
  selectionMode: z.enum(["auto", "manual"]).default("auto"),
  maxCostCredits: z.number().nonnegative().optional(),
});

export const mediaRouteSchema = z.object({
  requestedModel: z.string().nullable(),
  selectedModel: z.string(),
  selectionMode: z.enum(["auto", "manual"]),
  fallback: z.boolean(),
  reason: z.string().nullable(),
  candidateModels: z.array(z.string()),
  // Kept for the existing chat/job cards while new callers use the normalized fields above.
  requestedModels: z.array(z.string()).optional(),
  preferredModel: z.string().nullable().optional(),
  inputImage: z.boolean().optional(),
  duration: z.number().int().positive().optional(),
  resolution: z.string().optional(),
  normalized: z.object({
    enableAudio: z.boolean(),
    inputImageCount: z.number().int().nonnegative(),
    durationSeconds: z.number().int().positive().optional(),
    resolution: z.string().optional(),
  }),
});

export const feedAutomationRequestSchema = z.object({
  packageId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160).optional(),
  brief: z.string().trim().min(1).max(4000).optional(),
  topic: z.string().trim().max(500).default(""),
  goal: z.string().trim().min(1).max(120).optional(),
  contentType: z.string().trim().min(1).max(120).default("短视频"),
  platforms: z.array(z.string().trim().min(1).max(64)).min(1).max(16).optional(),
  durationSeconds: z.number().int().min(5).max(300).default(15),
  modelId: z.string().trim().max(160).nullable().default(null),
  idempotencyKey: z.string().trim().min(8).max(160),
});

export const workflowStepSchema = z.object({
  id: z.string().min(1).max(80),
  tool: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
  status: z.enum(["pending", "running", "completed", "failed", "awaiting_approval"]),
  dependsOn: z.array(z.string()).default([]),
  retryable: z.boolean().default(true),
  requiresApproval: z.boolean().default(false),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

export const agentWorkflowPlanSchema = z.object({
  goal: z.string().min(1).max(4000),
  status: z.enum(["planned", "running", "paused", "completed", "failed"]),
  steps: z.array(workflowStepSchema).min(1).max(32),
  approvalGate: z.object({ required: z.boolean(), reason: z.string().optional(), stepId: z.string().optional() }),
});

export const assetRetentionStateSchema = z.object({
  assetId: z.string().uuid(),
  state: z.enum(["active", "soft_deleted", "purged"]),
  retentionUntil: z.string().datetime().nullable(),
  purgeAfter: z.string().datetime().nullable(),
  favorited: z.boolean(),
});

export type MediaIntent = z.infer<typeof mediaIntentSchema>;
export type MediaRoute = z.infer<typeof mediaRouteSchema>;
export type FeedAutomationRequest = z.infer<typeof feedAutomationRequestSchema>;
export type AgentWorkflowPlan = z.infer<typeof agentWorkflowPlanSchema>;
export type AssetRetentionState = z.infer<typeof assetRetentionStateSchema>;
