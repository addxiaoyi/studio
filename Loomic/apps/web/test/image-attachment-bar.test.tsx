// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageAttachmentBar } from "../src/components/image-attachment-bar";

const attachment = {
  id: "attachment-1",
  file: new File(["image"], "cover.png", { type: "image/png" }),
  preview: "blob:cover",
  uploading: false,
  error: "上传失败",
  mimeType: "image/png",
  source: "upload" as const,
  name: "cover.png",
};

describe("ImageAttachmentBar", () => {
  afterEach(cleanup);

  it("exposes keyboard-usable retry and remove actions for failed uploads", async () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    render(<ImageAttachmentBar attachments={[attachment]} onRetry={onRetry} onRemove={onRemove} />);

    const retry = screen.getByRole("button", { name: "重试上传 cover.png" });
    expect(retry).toBeInTheDocument();
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledWith("attachment-1");

    const remove = screen.getByRole("button", { name: "移除 cover.png" });
    await userEvent.click(remove);
    expect(onRemove).toHaveBeenCalledWith("attachment-1");
  });
});
