import { describe, expect, it } from "vitest";
import { agentGoalDocumentSchema, agentGoalResultSchema } from "./agent-goals.js";

const document = {
  id: "goal:report", title: "网页说明", fileName: "website-report.md",
  mimeType: "text/markdown", content: "# Report\nOnly observed evidence.", sourceUrls: ["https://example.com/"],
};

describe("goal documents", () => {
  it("preserves documents while accepting legacy results", () => {
    expect(agentGoalResultSchema.parse({ documents: [document] }).documents).toEqual([document]);
    expect(agentGoalResultSchema.parse({ summary: "Legacy" }).documents).toBeUndefined();
  });
  it.each(["../secret.md", "report.html", "C:\\report.md", "report.md\r\nheader", "report.md\n"])("rejects unsafe filename %s", (fileName) => {
    expect(agentGoalDocumentSchema.safeParse({ ...document, fileName }).success).toBe(false);
  });
  it("rejects oversized or empty report content", () => {
    for (const content of ["", "x".repeat(250_001)]) {
      expect(agentGoalDocumentSchema.safeParse({ ...document, content }).success).toBe(false);
    }
  });
});
