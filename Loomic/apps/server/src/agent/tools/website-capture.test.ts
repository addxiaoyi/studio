import { describe, expect, it, vi } from "vitest";

import { createWebsiteCaptureTool } from "./website-capture.js";

describe("website_capture tool", () => {
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
