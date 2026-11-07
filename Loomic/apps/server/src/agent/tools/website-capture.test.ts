import { describe, expect, it, vi } from "vitest";

import { createWebsiteCaptureTool } from "./website-capture.js";

describe("website_capture tool", () => {
  it.each(["failed", "canceled"])('does not report a %s task as pending', async (status) => {
    const capture = createWebsiteCaptureTool({
      submitWebsiteCapture: vi.fn().mockResolvedValue({ taskId: "task-1", status, progress: 10, pending: true }),
    });

    const response = JSON.parse(await capture.invoke({ url: "https://example.com", mode: "isolated" }));
    expect(response).toMatchObject({ status, pending: false });
    expect(response.summary).not.toContain("后台处理");
  });

  it("does not record video unless the user asks for a recording", async () => {
    const submitWebsiteCapture = vi.fn().mockResolvedValue({
      taskId: "task-1",
      status: "queued",
      progress: 0,
      pending: true,
    });
    const capture = createWebsiteCaptureTool({ submitWebsiteCapture });

    await capture.invoke({ url: "https://example.com", mode: "isolated" });

    expect(submitWebsiteCapture).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://example.com",
      mode: "isolated",
      recordVideo: false,
    }));
  });
});
