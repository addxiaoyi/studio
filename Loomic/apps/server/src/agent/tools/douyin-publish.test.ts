import { describe, expect, it, vi } from "vitest";
import { createDouyinPublishDraftTool } from "./douyin-publish.js";

describe("prepare_douyin_publish", () => {
  it("returns a human approval handoff for a ready package", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: "package-1", title: "Package", status: "ready", variant_title: "Douyin title", body: "Body", hashtags: ["tag"], cover_text: "Cover" }] }) };
    const tool = createDouyinPublishDraftTool({ localDb: db as never, webOrigin: "https://studio.0st.top" });
    const output = await tool.invoke({ package_id: "11111111-1111-4111-8111-111111111111" }, { configurable: { user_id: "user-1" } } as never);
    expect(output).toMatchObject({ status: "approval_required", approvalRequired: true, manualOnly: true, platform: "douyin" });
    expect((output as { handoffUrl: string }).handoffUrl).toContain("step=5");
  });
});
