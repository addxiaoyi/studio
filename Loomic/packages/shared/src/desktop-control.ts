import { z } from "zod";

function isCredentialFreeHttpUrl(value: string) {
  const authority = value.match(/^https?:\/\/([^/?#]*)/i)?.[1] ?? "";
  return /^https?:\/\//i.test(value) && !authority.includes("@");
}

export const desktopAgentRoleSchema = z.enum(["planner", "researcher", "operator", "reviewer"]);
export const desktopAgentExecutionModeSchema = z.enum([
  "automatic",
  "isolated_browser",
  "connected_browser_tab",
  "windows_ui",
  "visual_ocr",
]);
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
  "window.click",
  "window.type",
  "window.key",
  "window.drag",
  "window.scroll",
]);
const readOnlyNativeMcpTools = new Set([
  "screen_observe",
  "screen_list_windows",
  "screen_wait_for_text",
  "screen_find",
]);

export function isReadOnlyNativeMcpTool(toolName: string) {
  return readOnlyNativeMcpTools.has(toolName);
}

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
  "native_click",
  "native_type",
  "native_key",
  "native_scroll",
  "native_drag",
  "native_double_click",
  "native_right_click",
  "wait",
  "native_wait_for_text",
]);

export const desktopAgentPlannedActionSchema = z.object({
  kind: desktopActionKindSchema,
  target: z.string().max(500).optional(),
  targetUrl: z.string().url().optional(),
  value: z.string().max(10_000).optional(),
  top: z.number().finite().optional(),
  fieldType: z.string().max(80).optional(),
  key: z.string().min(1).max(80).optional(),
  modifiers: z.array(z.enum(["ctrl", "alt", "shift", "meta", "cmd"])).max(4).optional(),
  x: z.number().finite().int().min(0).optional(),
  y: z.number().finite().int().min(0).optional(),
  toX: z.number().finite().int().min(0).optional(),
  toY: z.number().finite().int().min(0).optional(),
  dx: z.number().finite().optional(),
  dy: z.number().finite().optional(),
  durationMs: z.number().finite().int().min(0).max(60_000).optional(),
});

export const desktopAgentTaskRequestSchema = z.object({
  goal: z.string().trim().min(1).max(4_000),
  role: desktopAgentRoleSchema,
  capabilities: z.array(desktopCapabilitySchema).min(1).max(8),
  executionMode: desktopAgentExecutionModeSchema.default("automatic"),
  canvasId: z.string().uuid().optional(),
  plannedActions: z.array(desktopAgentPlannedActionSchema).max(8).default([]),
  targetUrl: z.string().url().refine(isCredentialFreeHttpUrl, "Target URL must be HTTP(S) and contain no credentials.").optional(),
  maxDurationSeconds: z.number().int().min(10).max(1_800).default(300),
  pageLimit: z.number().int().min(1).max(10).default(3),
});

export const desktopAgentActionSchema = z.object({
  requestId: z.string().min(1).max(160),
  taskId: z.string().uuid(),
  approvalId: z.string().uuid().optional(),
  kind: desktopActionKindSchema,
  target: z.string().max(500).optional(),
  targetUrl: z.string().url().optional(),
  value: z.string().max(10_000).optional(),
  top: z.number().finite().optional(),
  fieldType: z.string().max(80).optional(),
  key: z.string().min(1).max(80).optional(),
  modifiers: z.array(z.enum(["ctrl", "alt", "shift", "meta", "cmd"])).max(4).optional(),
  x: z.number().finite().int().min(0).optional(),
  y: z.number().finite().int().min(0).optional(),
  toX: z.number().finite().int().min(0).optional(),
  toY: z.number().finite().int().min(0).optional(),
  dx: z.number().finite().optional(),
  dy: z.number().finite().optional(),
  durationMs: z.number().finite().int().min(0).max(60_000).optional(),
  approvalToken: z.string().min(16).max(256).optional(),
});

export const desktopAgentTaskSchema = desktopAgentTaskRequestSchema.extend({
  taskId: z.string().uuid(),
  createdAt: z.string(),
  plannedActions: z.array(desktopAgentActionSchema).max(8).default([]),
});

export const desktopAgentEventSchema = z.object({
  taskId: z.string().uuid(),
  eventType: z.enum(["started", "plan", "step", "evidence", "asset_created", "progress", "page", "approval_required", "approval_expired", "deadline_warning", "completed", "failed", "canceled"]),
  approvalId: z.string().uuid().optional(),
  stepId: z.string().max(120).optional(),
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
    summary: z.string().max(8_000).optional(),
    evidence: z.array(z.object({
      kind: z.enum(["page", "screenshot", "recording", "window", "ocr"]),
      sourceUrl: z.string().url().optional(),
      title: z.string().max(500).optional(),
      excerpt: z.string().max(8_000).optional(),
      assetId: z.string().uuid().optional(),
    }).strict()).max(24).optional(),
    screenshotBase64: z.string().max(11_200_000).optional(),
    screenshotMimeType: z.enum(["image/jpeg", "image/png"]).optional(),
    recordingBase64: z.string().max(56_000_000).optional(),
    recordingUploadId: z.string().uuid().optional(),
  }).strict().optional(),
});

export type DesktopAgentRole = z.infer<typeof desktopAgentRoleSchema>;
export type DesktopAgentExecutionMode = z.infer<typeof desktopAgentExecutionModeSchema>;
export type DesktopCapability = z.infer<typeof desktopCapabilitySchema>;
export type DesktopActionKind = z.infer<typeof desktopActionKindSchema>;
export type DesktopAgentTaskRequest = z.infer<typeof desktopAgentTaskRequestSchema>;
export type DesktopAgentTask = z.infer<typeof desktopAgentTaskSchema>;
export type DesktopAgentAction = z.infer<typeof desktopAgentActionSchema>;
export type DesktopAgentEvent = z.infer<typeof desktopAgentEventSchema>;
export type DesktopAgentPlanStep = { id: string; title: string; status: "queued" | "running" | "succeeded" | "failed" };
export type DesktopAgentEvidence = NonNullable<DesktopAgentEvent["result"]>["evidence"] extends (infer T)[] | undefined ? T : never;
export type DesktopAgentApproval = { approvalId: string; action: DesktopAgentAction; expiresAt: string };
export type DesktopAgentAsset = { id: string; url: string; mediaType: "image" | "video" };
export type DesktopAgentResult = { summary?: string; evidence?: DesktopAgentEvidence[]; assets?: DesktopAgentAsset[] };

const actionCapabilities: Record<DesktopActionKind, DesktopCapability | null> = {
  focus_window: "window.focus",
  read_page: "browser.read",
  navigate: "browser.navigate",
  scroll: "browser.scroll",
  capture_screen: "browser.capture",
  start_recording: "browser.record",
  stop_recording: "browser.record",
  click: "browser.click",
  type: "browser.type",
  native_click: "window.click",
  native_type: "window.type",
  native_key: "window.key",
  native_scroll: "window.scroll",
  native_drag: "window.drag",
  native_double_click: "window.click",
  native_right_click: "window.click",
  wait: null,
  native_wait_for_text: "screen.read",
};

export function isDesktopActionAuthorized(action: DesktopAgentAction, capabilities: readonly DesktopCapability[]) {
  const capability = actionCapabilities[action.kind];
  return capability !== null && capabilities.includes(capability);
}

const alwaysDeniedFieldTypes = new Set(["password", "otp", "one-time-code", "verification-code"]);
const approvalActions = new Set<DesktopActionKind>(["click", "type", "native_click", "native_type", "native_key", "native_drag", "start_recording", "stop_recording"]);

const allowedNativeKeys = new Set([
  "enter", "tab", "escape", "space", "backspace", "delete",
  "up", "down", "left", "right", "home", "end", "pageup", "pagedown",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
]);

function isNativeKeyAllowed(key: string | undefined): boolean {
  if (!key) return false;
  return allowedNativeKeys.has(key.trim().toLowerCase());
}

export function classifyDesktopAction(action: DesktopAgentAction | null | undefined): "allow" | "confirm" | "deny" {
  if (!action) return "deny";
  if (alwaysDeniedFieldTypes.has((action.fieldType ?? "").toLowerCase())) return "deny";
  if ((action.kind === "type" || action.kind === "native_type") && !action.value) return "deny";
  if (action.kind === "native_key" && !isNativeKeyAllowed(action.key)) return "deny";
  if (action.kind === "native_drag" && (action.x === undefined || action.y === undefined || action.toX === undefined || action.toY === undefined)) return "deny";
  if (approvalActions.has(action.kind)) return action.approvalToken ? "confirm" : "deny";
  return "allow";
}
