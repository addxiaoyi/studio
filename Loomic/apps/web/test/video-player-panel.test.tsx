// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("loads private recordings through the authenticated media path", async () => {
    const asset = "a5639cd6-8284-44c3-af37-d194586465d9";
    const fetchMedia = vi.fn(async () => new Response(new Uint8Array([1,2,3]), { headers: { "content-type": "video/webm" } }));
    const NativeURL = globalThis.URL;
    vi.stubGlobal("fetch", fetchMedia);
    vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL: () => "blob:private-preview", revokeObjectURL: vi.fn() }));
    render(<VideoPlayerPanel elementId="video" elementBounds={{ x: 0, y: 0, width: 320, height: 180 }} videoUrl={`/api/uploads/${asset}/file`} mimeType="video/webm" accessToken="private-token" canvasScrollZoom={{ scrollX: 0, scrollY: 0, zoom: 1 }} onClose={() => {}} />);
    expect(await screen.findByLabelText("视频播放器")).toHaveAttribute("src", "blob:private-preview");
    expect(fetchMedia).toHaveBeenCalledWith(expect.stringContaining(`/api/uploads/${asset}/file`), expect.objectContaining({ headers: { Authorization: "Bearer private-token" }, redirect: "error" }));
    expect(screen.getByRole("link", { name: "下载 WebM 演示录像" })).toHaveAttribute("href", "blob:private-preview");
  });

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
  it("closes with Escape from the focused player control", async () => {
    const user = userEvent.setup(); render(<VideoPreviewHarness />);
    await user.click(screen.getByRole("button", { name: "打开视频预览" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开视频预览" })).toHaveFocus();
  });
});
