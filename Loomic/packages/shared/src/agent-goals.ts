import { z } from "zod";
import { goalCommandSchema, goalStepReceiptSchema } from "./goal-execution.js";

import {
  desktopAgentActionSchema,
  desktopAgentExecutionModeSchema,
  desktopAgentRoleSchema,
  desktopCapabilitySchema,
} from "./desktop-control.js";

export const agentGoalStatusSchema = z.enum([
  "draft",
  "running",
  "waiting_approval",
  "waiting_desktop",
  "paused",
  "completed",
  "failed",
  "canceled",
]);

export const agentGoalTaskStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "waiting_desktop",
  "paused",
  "succeeded",
  "failed",
  "canceled",
]);

export const agentGoalStepRiskSchema = z.enum(["read_only", "automatic", "approval", "paid"]);
export const agentGoalOutputKindSchema = z.enum(["auto", "canvas", "document", "image", "video", "bundle"]);
export const agentGoalSourceSchema = z.enum(["user", "suggestion", "scheduled"]);
export const agentGoalExecutionPolicySchema = z.enum(["approval_required", "suggest_only"]);
export const agentGoalSuggestionStateSchema = z.enum(["none", "suggested", "accepted", "dismissed"]);

export const agentGoalPlanStepSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(500),
  status: z.enum(["queued", "running", "succeeded", "failed", "skipped"]),
  risk: agentGoalStepRiskSchema,
  requiresDesktop: z.boolean().default(false),
  requiresApproval: z.boolean().default(false),
  estimatedCost: z.number().finite().nonnegative().optional(),
  executor: z.string().optional(),
  command: goalCommandSchema.optional(),
  dependsOn: z.array(z.string()).optional(),
  completion: z.string().optional(),
  when: z.array(z.object({source:z.string(),branch:z.enum(["true","false"])})).max(8).optional(),
});

export const agentGoalPlanSchema = z.object({
  version: z.literal(2).optional(),
  summary: z.string().optional(),
  steps: z.array(agentGoalPlanStepSchema).max(32),
  generatedAt: z.string().datetime({ offset: true }),
});

export const agentGoalDocumentSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(500),
  fileName: z.string().regex(/^[a-zA-Z0-9_-]+\.md(?![\s\S])/).max(180),
  mimeType: z.literal("text/markdown"),
  content: z.string().min(1).max(250_000),
  sourceUrls: z.array(z.string().url()).max(32),
});

export type AgentGoalDocument = z.infer<typeof agentGoalDocumentSchema>;

export const agentGoalResultSchema = z.object({
  summary: z.string().optional(),
  documents: z.array(agentGoalDocumentSchema).max(16).optional(),
  evidence: z.array(z.record(z.unknown())).max(64).optional(),
  assets: z.array(z.record(z.unknown())).max(64).optional(),
  cost: z.record(z.unknown()).optional(),
  sourceUrl: z.string().url().optional(),
  executionMode: desktopAgentExecutionModeSchema.optional(),
  canvasElementIds: z.array(z.string()).max(64).optional(),
  localPaths: z.array(z.string().max(4_096)).max(64).optional(),
  cloudAssetIds: z.array(z.string().uuid()).max(64).optional(),
  saveState: z.enum(["local", "cloud", "mixed", "pending"]).optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
});

export const agentGoalOutputSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid(),
  kind: z.string().min(1).max(120),
  localPath: z.string().max(4_096).nullable().optional(),
  cloudAssetId: z.string().uuid().nullable().optional(),
  status: z.enum(["pending", "saved_local", "saved_cloud", "saved_both", "failed"]),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const agentGoalCreateRequestSchema = z.object({
  goal: z.string().trim().min(1).max(4_000),
  canvasId: z.string().uuid().optional(),
  chatSessionId: z.string().uuid().optional(),
  executionMode: desktopAgentExecutionModeSchema.default("automatic"),
  outputKind: agentGoalOutputKindSchema.default("auto"),
  source: agentGoalSourceSchema.default("user"),
  executionPolicy: agentGoalExecutionPolicySchema.default("approval_required"),
  parentGoalId: z.string().uuid().optional(),
  connectionIds: z.array(z.string().min(1).max(160)).max(16).default([]),
  memoryContextIds: z.array(z.string().uuid()).max(16).default([]),
  capabilities: z.array(desktopCapabilitySchema).max(16).default([]),
  attachments: z.array(z.record(z.unknown())).max(16).default([]),
  idempotencyKey: z.string().trim().min(1).max(160),
});

export const agentGoalActivitySchema = z.object({
  id: z.union([z.string(), z.number()]),
  taskId: z.string().uuid().optional(),
  eventType: z.string().min(1),
  detail: z.string().nullable().optional(),
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime({ offset: true }),
});

export const agentGoalApprovalSchema = z.object({
  approvalId: z.string().uuid(),
  taskId: z.string().uuid(),
  action: desktopAgentActionSchema,
  status: z.enum(["pending", "approved", "rejected", "expired", "executed"]),
  expiresAt: z.string().datetime({ offset: true }),
});

export const agentGoalTaskSchema = z.object({
  taskId: z.string().uuid(),
  goalId: z.string().uuid().nullable().optional(),
  parentTaskId: z.string().uuid().nullable().optional(),
  goal: z.string(),
  role: desktopAgentRoleSchema,
  executionMode: desktopAgentExecutionModeSchema,
  outputKind: agentGoalOutputKindSchema.default("auto"),
  source: agentGoalSourceSchema.default("user"),
  executionPolicy: agentGoalExecutionPolicySchema.default("approval_required"),
  parentGoalId: z.string().uuid().nullable().optional(),
  connectionIds: z.array(z.string().min(1).max(160)).default([]),
  memoryContextIds: z.array(z.string().uuid()).default([]),
  suggestionState: agentGoalSuggestionStateSchema.default("none"),
  capabilities: z.array(desktopCapabilitySchema),
  status: agentGoalTaskStatusSchema,
  checkpoint: z.record(z.unknown()).nullable().optional(),
  reviewAvailable: z.boolean().optional(),
  waitReason: z.string().nullable().optional(),
  result: z.record(z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const agentGoalSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  createdBy: z.string().uuid(),
  canvasId: z.string().uuid().nullable().optional(),
  chatSessionId: z.string().uuid().nullable().optional(),
  goal: z.string(),
  status: agentGoalStatusSchema,
  plan: agentGoalPlanSchema,
  executionMode: desktopAgentExecutionModeSchema,
  outputKind: agentGoalOutputKindSchema.default("auto"),
  source: agentGoalSourceSchema.default("user"),
  executionPolicy: agentGoalExecutionPolicySchema.default("approval_required"),
  parentGoalId: z.string().uuid().nullable().optional(),
  connectionIds: z.array(z.string().min(1).max(160)).default([]),
  memoryContextIds: z.array(z.string().uuid()).default([]),
  suggestionState: agentGoalSuggestionStateSchema.default("none"),
  capabilities: z.array(desktopCapabilitySchema),
  tasks: z.array(agentGoalTaskSchema).default([]),
  activities: z.array(agentGoalActivitySchema).default([]),
  approvals: z.array(agentGoalApprovalSchema).default([]),
  outputs: z.array(agentGoalOutputSchema).default([]),
  executionSteps: z.array(goalStepReceiptSchema).optional(),
  result: agentGoalResultSchema.nullable().optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export type AgentGoalStatus = z.infer<typeof agentGoalStatusSchema>;
export type AgentGoalTaskStatus = z.infer<typeof agentGoalTaskStatusSchema>;
export type AgentGoalPlanStep = z.infer<typeof agentGoalPlanStepSchema>;
export type AgentGoalPlan = z.infer<typeof agentGoalPlanSchema>;
export type AgentGoalResult = z.infer<typeof agentGoalResultSchema>;
export type AgentGoalOutput = z.infer<typeof agentGoalOutputSchema>;
export type AgentGoalCreateRequest = z.input<typeof agentGoalCreateRequestSchema>;
export type AgentGoalActivity = z.infer<typeof agentGoalActivitySchema>;
export type AgentGoalApproval = z.infer<typeof agentGoalApprovalSchema>;
export type AgentGoalTask = z.infer<typeof agentGoalTaskSchema>;
export type AgentGoal = z.infer<typeof agentGoalSchema>;

export const agentMemorySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["preference", "workflow", "goal", "connection", "storage"]),
  key: z.string().min(1).max(160),
  value: z.string().min(1).max(2_000),
  source: z.string().max(500).optional(),
  confidence: z.number().finite().min(0).max(1),
  enabled: z.boolean(),
  lastUsedAt: z.string().datetime({ offset: true }).nullable().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const agentSuggestionSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["goal", "memory", "workflow"]),
  title: z.string().min(1).max(300),
  detail: z.string().max(2_000),
  goal: z.string().max(4_000).optional(),
  sourceMemoryIds: z.array(z.string().uuid()).max(16).default([]),
  status: z.enum(["pending", "accepted", "dismissed", "expired"]),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export type AgentMemory = z.infer<typeof agentMemorySchema>;
export type AgentSuggestion = z.infer<typeof agentSuggestionSchema>;
