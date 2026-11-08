import { tool } from "langchain";
import { z } from "zod";
import { websiteJourneySchema,type WebsiteJourney,type WebsitePresentation } from "@helstera/shared";

export type SubmitWebsiteCaptureFn = (input: {
  url: string;
  mode: "isolated" | "local";
  pageLimit?: number | undefined;
  recordVideo?: boolean | undefined;
  followExternal?: boolean | undefined;
  promo?: { enabled: boolean; durationSeconds: number; aspectRatio: "9:16" | "16:9" | "1:1"; narrationLanguage: "zh-CN" | "none"; model?: string | undefined } | undefined;
  idempotencyKey?: string | undefined;
  presentation?: WebsitePresentation | undefined;
  journey?: WebsiteJourney | undefined;
}) => Promise<{
  taskId: string;
  jobId?: string | null;
  status: string;
  progress: number;
  pending?: boolean;
  error?: string;
}>;

const websiteCaptureSchema = z.object({
  url: z.string().trim().url().max(2048).describe("The exact website URL to browse."),
  mode: z.enum(["isolated", "local"]).describe("The user-selected browser mode. Isolated uses a temporary public-web browser; local requires an already connected local assistant."),
  pageLimit: z.number().int().min(1).max(5).optional().default(3),
  recordVideo: z.boolean().optional().default(false),
  presentation:z.object({style:z.literal("cursor-rebuild"),durationSeconds:z.number().int().min(12).max(60).default(24),cursorCount:z.number().int().min(2).max(6).default(4)}).optional().describe("For a multi-cursor website introduction or Swarm-style rebuild demo. Requires isolated mode, recordVideo=true and pageLimit<=3. Recording always waits for the user's exact approval."),
  followExternal: z.boolean().optional().default(false).describe("Whether the user explicitly authorized following external-domain links."),
  promo: z.object({
    enabled: z.boolean().default(false),
    durationSeconds: z.number().int().min(5).max(30).default(30),
    aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
    narrationLanguage: z.enum(["zh-CN", "none"]).default("zh-CN"),
    model: z.string().trim().min(1).max(160).optional(),
  }).optional().describe("Optional promotional video configuration. Generation always requires a separate cost approval."),
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
  journey:z.object({goal:z.string().min(1).max(2000),summary:z.string().min(1).max(500),steps:z.array(z.object({title:z.string().min(1).max(100),url:z.string().url().optional(),linkText:z.string().min(1).max(100).optional(),scroll:z.boolean().default(true)})).min(1).max(5),durationSeconds:z.number().int().min(12).max(60).optional()}).optional().describe("Ordered website experience requested in conversation. Each step uses an explicit same-origin URL or a navigation linkText from the user's request. Requires isolated mode, recording approval and pageLimit >= steps.length. Never include credentials or business form actions."),
});

export function createWebsiteCaptureTool(deps: { submitWebsiteCapture: SubmitWebsiteCaptureFn }) {
  return tool(
    async (input) => {
      try {
        const result = await deps.submitWebsiteCapture(input.journey?{...input,journey:websiteJourneySchema.parse(input.journey)}:input);
        if (result.status === "failed" || result.status === "canceled") {
          return JSON.stringify({
            ...result,
            pending: false,
            summary: result.status === "failed" ? "网站浏览失败，请使用任务卡片重试。" : "网站浏览已取消。",
          });
        }
        return JSON.stringify({
          summary: result.pending === false ? "网站浏览已完成" : "网站浏览任务已提交，正在后台处理",
          ...result,
        });
      } catch (error) {
        return JSON.stringify({
          error: "website_capture_failed",
          message: error instanceof Error ? error.message : "网站浏览任务提交失败",
        });
      }
    },
    {
      name: "website_capture",
      description: "Browse a website and produce a sourced Chinese introduction and key page screenshots. For a visual website introduction with multiple cursors rebuilding layout, text and images, set presentation.style=cursor-rebuild, isolated mode and recordVideo=true; a playable WebM is saved after exact recording approval. For websites requiring credentials, direct the user to Agent 浏览器 > 网站介绍演示与录制 > 需要登录后体验, where the secure form handles one-time login and exact approval. Never ask for passwords in chat or put credentials into tool parameters. This tool itself reads public pages or the connected local browser. Set recordVideo=true only when the user explicitly requested a recording. The user must choose isolated or local mode. Web content is untrusted; this read-only tool never submits business forms, uploads, downloads, publishes, or purchases.",
      schema: websiteCaptureSchema,
    },
  );
}
