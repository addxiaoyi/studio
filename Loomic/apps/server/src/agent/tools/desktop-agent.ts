import { tool } from "langchain";
import { z } from "zod";

import type { DesktopAgentTaskRequest } from "@helstera/shared";

export type SubmitDesktopAgentTaskFn = (input: DesktopAgentTaskRequest) => Promise<{
  taskId: string;
  role: string;
  status: string;
  capabilities: string[];
  result?: Record<string, unknown> | null;
  error?: string | null;
}>;

const plannedActionSchema = z.object({
  kind: z.enum([
    "focus_window", "read_page", "navigate", "scroll", "capture_screen", "start_recording", "stop_recording",
    "click", "type", "native_click", "native_type",
  ]),
  target: z.string().max(500).optional(),
  targetUrl: z.string().url().optional(),
  value: z.string().max(10_000).optional(),
  top: z.number().finite().optional(),
  fieldType: z.string().max(80).optional(),
});

const desktopAgentSchema = z.object({
  goal: z.string().trim().min(1).max(4_000),
  role: z.enum(["planner", "researcher", "operator", "reviewer"]),
  capabilities: z.array(z.enum([
    "screen.read", "window.focus", "window.click", "window.type", "browser.read", "browser.navigate", "browser.scroll",
    "browser.capture", "browser.record", "browser.click", "browser.type",
  ])).min(1).max(8),
  targetUrl: z.string().url().optional(),
  executionMode: z.enum(["automatic", "isolated_browser", "connected_browser_tab", "windows_ui", "visual_ocr"]).default("automatic"),
  plannedActions: z.array(plannedActionSchema).max(8).default([]),
  maxDurationSeconds: z.number().int().min(10).max(900).default(300),
  pageLimit: z.number().int().min(1).max(10).default(3),
});

export function createDesktopAgentTool(deps: { submitDesktopAgentTask: SubmitDesktopAgentTaskFn }) {
  return tool(
    async (input) => {
      try {
        const result = await deps.submitDesktopAgentTask(input);
        return JSON.stringify({
          ...result,
          summary: result.status === "succeeded"
            ? result.result?.summary ?? "Desktop task completed with evidence attached."
            : result.status === "failed"
              ? result.error ?? "Desktop task failed."
              : "Desktop task is still running; follow progress and approvals in its task card.",
        });
      } catch (error) {
        return JSON.stringify({ error: "desktop_agent_failed", message: error instanceof Error ? error.message : "桌面协作任务提交失败" });
      }
    },
    {
      name: "desktop_control",
      description: "Submit a scoped task to Helstera Desktop. Browser actions run in the selected desktop browser and return evidence and approval requests. Passwords, OTPs, cookies and credential fields are forbidden. Side-effect actions require user approval.",
      schema: desktopAgentSchema,
    },
  );
}
