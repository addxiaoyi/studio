import { tool } from "langchain";
import { z } from "zod";

import type { DesktopAgentTaskRequest } from "@helstera/shared";

export type SubmitDesktopAgentTaskFn = (input: DesktopAgentTaskRequest) => Promise<{
  taskId: string;
  role: string;
  status: string;
  capabilities: string[];
}>;

const desktopAgentSchema = z.object({
  goal: z.string().trim().min(1).max(4_000),
  role: z.enum(["planner", "researcher", "operator", "reviewer"]),
  capabilities: z.array(z.enum([
    "screen.read", "window.focus", "browser.read", "browser.navigate", "browser.scroll",
    "browser.capture", "browser.record", "browser.click", "browser.type",
  ])).min(1).max(8),
  targetUrl: z.string().url().optional(),
  maxDurationSeconds: z.number().int().min(10).max(900).default(300),
  pageLimit: z.number().int().min(1).max(10).default(3),
});

export function createDesktopAgentTool(deps: { submitDesktopAgentTask: SubmitDesktopAgentTaskFn }) {
  return tool(
    async (input) => {
      try {
        const result = await deps.submitDesktopAgentTask(input);
        return JSON.stringify({ summary: "桌面协作任务已提交。只会执行声明的能力；点击和输入等副作用动作仍需用户审批。", ...result });
      } catch (error) {
        return JSON.stringify({ error: "desktop_agent_failed", message: error instanceof Error ? error.message : "桌面协作任务提交失败" });
      }
    },
    {
      name: "desktop_control",
      description: "Use the user's connected Helstera desktop assistant for an explicitly requested, scoped desktop task. Choose a role and the smallest capabilities. Never use shell access, enter passwords/OTPs, upload, download, pay, publish, or delete; click/type actions require separate approval.",
      schema: desktopAgentSchema,
    },
  );
}
