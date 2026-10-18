import { describe, expect, it } from "vitest";
import { uniqueGenerationApprovals } from "../src/lib/generation-approval-visibility";

describe("generation approval visibility", () => {
  it("keeps one message card per approval and retains distinct approvals", () => {
    const result = uniqueGenerationApprovals([
      { contentBlocks: [{ type: "tool", toolCallId: "tool-1", output: { approvalId: "approval-1" } }] },
      { contentBlocks: [{ type: "tool", toolCallId: "tool-2", output: { approvalId: "approval-1" } }] },
      { contentBlocks: [{ type: "tool", toolCallId: "tool-3", output: { approvalId: "approval-2" } }] },
    ]);

    expect([...result.visibleIds]).toEqual(["approval-1", "approval-2"]);
    expect([...result.hiddenToolCallIds]).toEqual(["tool-2"]);
  });

  it("ignores non-tool blocks and malformed approval payloads", () => {
    const result = uniqueGenerationApprovals([
      { contentBlocks: [{ type: "text" }, { type: "tool", toolCallId: "tool-1", output: null }] },
    ]);

    expect(result.visibleIds.size).toBe(0);
    expect(result.hiddenToolCallIds.size).toBe(0);
  });

  it("keeps one media status block for a Job even when duplicate results omit approval IDs", () => {
    const result = uniqueGenerationApprovals([
      { contentBlocks: [{ type: "tool", toolCallId: "media-1", toolName: "generate_video", output: { jobId: "job-1" } }] },
      { contentBlocks: [{ type: "tool", toolCallId: "media-2", toolName: "generate_video", output: { jobId: "job-1" } }] },
      { contentBlocks: [{ type: "tool", toolCallId: "media-3", toolName: "generate_image", output: { jobId: "job-2" } }] },
    ]);

    expect([...result.hiddenJobToolCallIds]).toEqual(["media-2"]);
  });
});
