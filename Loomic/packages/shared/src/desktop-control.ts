import { z } from "zod";

function isCredentialFreeHttpUrl(value: string) {
  const authority = value.match(/^https?:\/\/([^/?#]*)/i)?.[1] ?? "";
  return /^https?:\/\//i.test(value) && !authority.includes("@");
}

export const desktopAgentRoleSchema = z.enum(["planner", "researcher", "operator", "reviewer"]);
export const desktopCapabilitySchema = z.enum([
  "screen.read",
  "window.focus",
  "browser.read",
  "browser.navigate",
  "browser.scroll",
  "browser.capture",
  "browser.record",
  "browser.click",
  "browser.type",
]);
export const desktopActionKindSchema = z.enum([
  "focus_window",
  "read_page",
  "navigate",
  "scroll",
  "capture_screen",
  "start_recording",
  "stop_recording",
  "click",
  "type",
]);

export const desktopAgentTaskRequestSchema = z.object({
  goal: z.string().trim().min(1).max(4_000),
  role: desktopAgentRoleSchema,
  capabilities: z.array(desktopCapabilitySchema).min(1).max(8),
  targetUrl: z.string().url().refine(isCredentialFreeHttpUrl, "Target URL must be HTTP(S) and contain no credentials.").optional(),
  maxDurationSeconds: z.number().int().min(10).max(900).default(300),
  pageLimit: z.number().int().min(1).max(10).default(3),
});

export const desktopAgentTaskSchema = desktopAgentTaskRequestSchema.extend({
  taskId: z.string().uuid(),
  createdAt: z.string(),
});

export const desktopAgentActionSchema = z.object({
  requestId: z.string().min(1).max(160),
  taskId: z.string().uuid(),
  kind: desktopActionKindSchema,
  target: z.string().max(500).optional(),
  targetUrl: z.string().url().optional(),
  value: z.string().max(10_000).optional(),
  top: z.number().finite().optional(),
  fieldType: z.string().max(80).optional(),
  approvalToken: z.string().min(16).max(256).optional(),
});

export const desktopAgentEventSchema = z.object({
  taskId: z.string().uuid(),
  eventType: z.enum(["started", "progress", "page", "approval_required", "completed", "failed"]),
  approvalId: z.string().uuid().optional(),
  detail: z.string().max(2_000).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  action: desktopAgentActionSchema.optional(),
  result: z.object({
    page: z.object({
      url: z.string().url().max(2048).refine(isCredentialFreeHttpUrl),
      title: z.string().max(500).optional(),
      description: z.string().max(1_000).optional(),
      headings: z.array(z.string().max(500)).max(16).optional(),
      navigation: z.array(z.string().max(300)).max(24).optional(),
    }).optional(),
    screenshotBase64: z.string().max(11_200_000).optional(),
  }).strict().optional(),
});

export type DesktopAgentRole = z.infer<typeof desktopAgentRoleSchema>;
export type DesktopCapability = z.infer<typeof desktopCapabilitySchema>;
export type DesktopActionKind = z.infer<typeof desktopActionKindSchema>;
export type DesktopAgentTaskRequest = z.infer<typeof desktopAgentTaskRequestSchema>;
export type DesktopAgentTask = z.infer<typeof desktopAgentTaskSchema>;
export type DesktopAgentAction = z.infer<typeof desktopAgentActionSchema>;
export type DesktopAgentEvent = z.infer<typeof desktopAgentEventSchema>;

const alwaysDeniedFieldTypes = new Set(["password", "otp", "one-time-code", "verification-code"]);
const approvalActions = new Set<DesktopActionKind>(["click", "type", "start_recording", "stop_recording"]);

export function classifyDesktopAction(action: DesktopAgentAction | null | undefined): "allow" | "confirm" | "deny" {
  if (!action) return "deny";
  if (alwaysDeniedFieldTypes.has((action.fieldType ?? "").toLowerCase())) return "deny";
  if (action.kind === "type" && !action.value) return "deny";
  if (approvalActions.has(action.kind)) return action.approvalToken ? "confirm" : "deny";
  return "allow";
}
