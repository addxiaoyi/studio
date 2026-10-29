import { z } from "zod";

import {
  assetObjectSchema,
  canvasContentSchema,
  canvasDetailSchema,
  chatMessageSchema,
  chatSessionSummarySchema,
  modelInfoSchema,
  projectSourceSchema,
  projectSummarySchema,
  runIdSchema,
  viewerProfileSchema,
  workspaceMembershipSchema,
  workspaceSettingsSchema,
  workspaceSummarySchema,
} from "./contracts.js";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("helstera-server"),
  version: z.string().min(1),
});

export const runCancelResponseSchema = z.object({
  runId: runIdSchema,
  status: z.enum(["canceling", "canceled"]),
});

export const viewerCreditsSchema = z.object({
  balance: z.number().finite().nonnegative(),
  plan: z.string(),
  dailyClaimed: z.boolean(),
  limits: z.object({
    maxConcurrentJobs: z.number().int(),
    maxResolution: z.string(),
    monthlyCredits: z.number().int(),
    dailyCredits: z.number().int(),
  }),
});

export const viewerResponseSchema = z.object({
  profile: viewerProfileSchema,
  workspace: workspaceSummarySchema,
  membership: workspaceMembershipSchema,
  isSystemAdmin: z.boolean().default(false),
  credits: viewerCreditsSchema.optional(),
});

export const projectListResponseSchema = z.object({
  projects: z.array(projectSummarySchema),
});

export const projectCreateRequestSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  /**
   * Creation entry point. Omitted by the legacy "new project" callers, which
   * the service treats as `manual` (same value as the database default).
   */
  source: projectSourceSchema.optional(),
});

export const projectCreateResponseSchema = z.object({
  project: projectSummarySchema,
});

export const unauthenticatedErrorResponseSchema = z.object({
  error: z.object({
    code: z.literal("unauthorized"),
    message: z.string().min(1),
  }),
});

/**
 * 已知错误码白名单（对外契约的一部分：前端可按这些码做分支/文案映射）。
 *
 * 重要：这份清单**不是**出站校验闸门。
 * - `applicationErrorCodeSchema`（封闭枚举）只回答"这是不是我们已经约定过的码"，
 *   适合前端 `switch` 与测试断言；
 * - 服务端还会发送清单之外的码（平台/支付/第三方通道回传、服务层细分码），
 *   出站响应必须用 `applicationErrorCodeSchemaLoose` /
 *   `applicationErrorResponseSchemaLoose` 校验，否则 Fastify 会因 ZodError
 *   抛出 500 通用错误，客户端拿不到可读 `code`（历史上已发生 13 处）。
 */
export const applicationErrorCodeValues = [
  "application_error",
  "bootstrap_failed",
  "brand_kit_not_found",
  "brand_kit_create_failed",
  "brand_kit_update_failed",
  "brand_kit_delete_failed",
  "brand_kit_query_failed",
  "brand_kit_asset_not_found",
  "brand_kit_asset_create_failed",
  "canvas_not_found",
  "canvas_save_failed",
  "chat_error",
  "profile_update_failed",
  "project_query_failed",
  "project_create_failed",
  "project_delete_failed",
  "project_not_found",
  "project_slug_taken",
  "project_update_failed",
  "session_not_found",
  "settings_not_found",
  "settings_update_failed",
  "upload_failed",
  "asset_not_found",
  "job_not_found",
  "job_create_failed",
  "job_query_failed",
  "job_cancel_failed",
  "skill_not_found",
  "skill_create_failed",
  "skill_update_failed",
  "skill_delete_failed",
  "skill_query_failed",
  "skill_install_failed",
  "skill_uninstall_failed",
  "skill_toggle_failed",
  "skill_import_failed",
  "skill_file_query_failed",
  "marketplace_search_failed",
  "marketplace_detail_failed",
  "marketplace_install_failed",
  "insufficient_credits",
  "credit_query_failed",
  "credit_claim_failed",
  "credit_deduct_failed",
  "credit_refund_failed",
  "credit_plan_update_failed",
  "model_not_accessible",
  "resolution_not_allowed",
  "concurrency_limit",
  "variant_not_found",
  "checkout_failed",
  "generation_failed",
  "generation_confirmation_required",
  // ── 补登记：服务端实际会发送、原先漏在枚举外的码 ────────────────────
  // 补登记 ≠ 不再需要兜底：下面这些只是"已知且稳定"的那部分。
  "invalid_request",
  "invalid_input",
  "submission_failed",
  "query_failed",
  "provider_not_configured",
  "service_unavailable",
  "model_retired",
  "canvas_version_conflict",
  "invalid_if_match",
  "topup_failed",
  "topup_activate_failed",
  "settings_read_failed",
  "payment_not_configured",
  "subscription_not_found",
  "subscription_update_failed",
  "webhook_processing_failed",
] as const;

/** 已知码枚举：问"这个码是不是我们约定过的"，**不要**拿它校验出站响应。 */
export const applicationErrorCodeSchema = z.enum(applicationErrorCodeValues);

/**
 * 宽松兜底格式：小写字母开头的 snake_case，长度 3~64。
 * 仍然拒绝空串、大写、含空格/连字符/其他标点、超长、数字开头的垃圾 code。
 */
export const applicationErrorCodePattern = /^[a-z][a-z0-9_]{2,63}$/u;

/**
 * 出站错误码校验：已知码白名单优先，白名单外的"格式合法"码兜底放行。
 *
 * 之所以不是 `z.string()` 全放开：code 会进日志、指标标签、前端分支，
 * 需要保证它始终是可控形状的标识符。
 */
export const applicationErrorCodeSchemaLoose = z.union([
  applicationErrorCodeSchema,
  z
    .string()
    .regex(
      applicationErrorCodePattern,
      "Error code must be a 3-64 char lowercase snake_case identifier.",
    ),
]);

export const applicationErrorResponseSchema = z.object({
  error: z.object({
    code: applicationErrorCodeSchema,
    message: z.string().min(1),
  }),
});

/** 出站（服务端 → 客户端）错误响应契约：任何现有 code 都不再抛 ZodError。 */
export const applicationErrorResponseSchemaLoose = z.object({
  error: z.object({
    code: applicationErrorCodeSchemaLoose,
    message: z.string().min(1),
  }),
});

export const canvasGetResponseSchema = z.object({
  canvas: canvasDetailSchema,
});

export const canvasSaveRequestSchema = z.object({
  content: canvasContentSchema,
});

export const canvasSaveResponseSchema = z.object({
  ok: z.literal(true),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type RunCancelResponse = z.infer<typeof runCancelResponseSchema>;
export type ViewerCredits = z.infer<typeof viewerCreditsSchema>;
export type ViewerResponse = z.infer<typeof viewerResponseSchema>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
export type ProjectCreateRequest = z.infer<typeof projectCreateRequestSchema>;
export type ProjectCreateResponse = z.infer<typeof projectCreateResponseSchema>;
export type UnauthenticatedErrorResponse = z.infer<
  typeof unauthenticatedErrorResponseSchema
>;
export type ApplicationErrorCode = z.infer<typeof applicationErrorCodeSchema>;
export type ApplicationErrorCodeLoose = z.infer<
  typeof applicationErrorCodeSchemaLoose
>;
export type ApplicationErrorResponse = z.infer<
  typeof applicationErrorResponseSchema
>;
export type ApplicationErrorResponseLoose = z.infer<
  typeof applicationErrorResponseSchemaLoose
>;
export const profileUpdateResponseSchema = z.object({
  profile: viewerProfileSchema,
});

export const workspaceSettingsResponseSchema = z.object({
  settings: workspaceSettingsSchema,
});

export const workspaceSettingsUpdateRequestSchema = workspaceSettingsSchema;

export const modelListResponseSchema = z.object({
  models: z.array(modelInfoSchema),
});

export const sessionListResponseSchema = z.object({
  sessions: z.array(chatSessionSummarySchema),
});

export const sessionCreateResponseSchema = z.object({
  session: chatSessionSummarySchema,
});

export const messageListResponseSchema = z.object({
  messages: z.array(chatMessageSchema),
});

export const messageCreateResponseSchema = z.object({
  message: chatMessageSchema,
});

export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
export type SessionCreateResponse = z.infer<typeof sessionCreateResponseSchema>;
export type MessageListResponse = z.infer<typeof messageListResponseSchema>;
export type MessageCreateResponse = z.infer<typeof messageCreateResponseSchema>;
export type CanvasGetResponse = z.infer<typeof canvasGetResponseSchema>;
export type CanvasSaveRequest = z.infer<typeof canvasSaveRequestSchema>;
export type CanvasSaveResponse = z.infer<typeof canvasSaveResponseSchema>;
export type ProfileUpdateResponse = z.infer<typeof profileUpdateResponseSchema>;
export type WorkspaceSettingsResponse = z.infer<
  typeof workspaceSettingsResponseSchema
>;
export type WorkspaceSettingsUpdateRequest = z.infer<
  typeof workspaceSettingsUpdateRequestSchema
>;
export type ModelListResponse = z.infer<typeof modelListResponseSchema>;

export const uploadResponseSchema = z.object({
  asset: assetObjectSchema,
  url: z.string().min(1),
});

export const assetSignedUrlResponseSchema = z.object({
  url: z.string().min(1),
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export type AssetSignedUrlResponse = z.infer<
  typeof assetSignedUrlResponseSchema
>;

export const projectUpdateRequestSchema = z.object({
  brand_kit_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(100).optional(),
});
export type ProjectUpdateRequest = z.infer<typeof projectUpdateRequestSchema>;
