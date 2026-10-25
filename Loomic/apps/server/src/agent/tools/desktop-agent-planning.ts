import { z } from "zod";

const capabilityActions: Record<string, string[]> = {
  "window.focus": ["focus_window"],
  "window.click": ["native_click", "native_double_click", "native_right_click"],
  "window.type": ["native_type"],
  "window.key": ["native_key"],
  "window.drag": ["native_drag"],
  "window.scroll": ["native_scroll"],
  "screen.read": ["native_wait_for_text"],
  "browser.read": ["read_page"],
  "browser.navigate": ["navigate"],
  "browser.scroll": ["scroll"],
  "browser.capture": ["capture_screen"],
  "browser.record": ["start_recording", "stop_recording"],
  "browser.click": ["click"],
  "browser.type": ["type"],
};

export function actionsAllowedForCapabilities(capabilities: readonly string[]): string[] {
  const allowed = new Set<string>(["wait", "capture_screen"]);
  for (const capability of capabilities) {
    for (const action of capabilityActions[capability] ?? []) allowed.add(action);
  }
  return [...allowed];
}

export const plannedActionOutputSchema = z.object({
  kind: z.enum([
    "focus_window", "read_page", "navigate", "scroll", "capture_screen", "start_recording", "stop_recording",
    "click", "type", "native_click", "native_type",
    "native_key", "native_scroll", "native_drag", "native_double_click", "native_right_click", "wait",
    "native_wait_for_text",
  ]),
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

export function filterActionsByCapabilities<T extends { kind: string }>(
  actions: readonly T[],
  capabilities: readonly string[],
): T[] {
  const allowed = new Set(actionsAllowedForCapabilities(capabilities));
  return actions.filter((action) => allowed.has(action.kind)).slice(0, 8);
}
