import { z } from "zod";

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

export const agentGoalPlanStepSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(500),
  status: z.enum(["queued", "running", "succeeded", "failed", "skipped"]),
  risk: agentGoalStepRiskSchema,
  requiresDesktop: z.boolean().default(false),
  requiresApproval: z.boolean().default(false),
  estimatedCost: z.number().finite().nonnegative().optional(),
});

export const agentGoalPlanSchema = z.object({
  steps: z.array(agentGoalPlanStepSchema).max(32),
  generatedAt: z.string().datetime({ offset: true }),
});

export const agentGoalResultSchema = z.object({
  summary: z.string().optional(),
  evidence: z.array(z.record(z.unknown())).max(64).optional(),
  assets: z.array(z.record(z.unknown())).max(64).optional(),
  cost: z.record(z.unknown()).optional(),
  sourceUrl: z.string().url().optional(),
  executionMode: desktopAgentExecutionModeSchema.optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
});

export const agentGoalCreateRequestSchema = z.object({
  goal: z.string().trim().min(1).max(4_000),
  canvasId: z.string().uuid().optional(),
  chatSessionId: z.string().uuid().optional(),
  executionMode: desktopAgentExecutionModeSchema.default("automatic"),
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
  capabilities: z.array(desktopCapabilitySchema),
  status: agentGoalTaskStatusSchema,
  checkpoint: z.record(z.unknown()).nullable().optional(),
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
  capabilities: z.array(desktopCapabilitySchema),
  tasks: z.array(agentGoalTaskSchema).default([]),
  activities: z.array(agentGoalActivitySchema).default([]),
  approvals: z.array(agentGoalApprovalSchema).default([]),
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
export type AgentGoalCreateRequest = z.infer<typeof agentGoalCreateRequestSchema>;
export type AgentGoalActivity = z.infer<typeof agentGoalActivitySchema>;
export type AgentGoalApproval = z.infer<typeof agentGoalApprovalSchema>;
export type AgentGoalTask = z.infer<typeof agentGoalTaskSchema>;
export type AgentGoal = z.infer<typeof agentGoalSchema>;
