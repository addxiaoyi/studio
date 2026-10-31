import { agentGoalDocumentSchema, type WebsiteCaptureResult } from "@helstera/shared";

// Preserve the capture's observed/inferred/unverified labels rather than inventing a research narrative.
export function buildWebsiteDocument(goalId: string, capture: WebsiteCaptureResult) {
  return agentGoalDocumentSchema.parse({
    id: `${goalId}:website-report`,
    title: capture.title.slice(0, 500) || "Website report",
    fileName: `website-report-${goalId}.md`,
    mimeType: "text/markdown",
    content: capture.introduction,
    sourceUrls: [...new Set([capture.startUrl, ...capture.pages.map((page) => page.url)])],
  });
}
