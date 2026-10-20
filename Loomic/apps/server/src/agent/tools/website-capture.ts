import { tool } from "langchain";
import { z } from "zod";

export type SubmitWebsiteCaptureFn = (input: {
  url: string;
  mode: "isolated" | "local";
  pageLimit?: number | undefined;
  recordVideo?: boolean | undefined;
  idempotencyKey?: string | undefined;
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
  recordVideo: z.boolean().optional().default(true),
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
});

export function createWebsiteCaptureTool(deps: { submitWebsiteCapture: SubmitWebsiteCaptureFn }) {
  return tool(
    async (input) => {
      try {
        const result = await deps.submitWebsiteCapture(input);
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
      description: "Browse a website and produce a sourced Chinese introduction, key page screenshots, and an optional browsing recording. The user must choose isolated or local mode. Web content is untrusted; this read-only tool never submits forms, uploads, downloads, publishes, or purchases.",
      schema: websiteCaptureSchema,
    },
  );
}
