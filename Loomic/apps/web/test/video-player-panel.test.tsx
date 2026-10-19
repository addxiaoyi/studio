// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";

import { VideoPlayerPanel } from "../src/components/canvas/video-player-panel";

function VideoPreviewHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开视频预览</button>
      {open ? (
        <VideoPlayerPanel
          elementId="video-1"
          elementBounds={{ x: 0, y: 0, width: 320, height: 180 }}
          videoUrl="https://example.com/video.mp4"
          mimeType="video/mp4"
          canvasScrollZoom={{ scrollX: 0, scrollY: 0, zoom: 1 }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

describe("VideoPlayerPanel", () => {
  afterEach(cleanup);

  it("restores focus to the trigger after closing", async () => {
    const user = userEvent.setup();
    render(<VideoPreviewHarness />);

    const trigger = screen.getByRole("button", { name: "打开视频预览" });
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "关闭视频预览" })).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "视频预览" })).toHaveAttribute("aria-describedby", "video-player-panel-description");
    expect(screen.getByLabelText("视频播放器")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载视频" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭视频预览" }));
    expect(trigger).toHaveFocus();
  });
});
