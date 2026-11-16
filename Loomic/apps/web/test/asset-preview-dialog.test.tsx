// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeneratedAsset } from "@/lib/server-api";

const { preparePrivateMedia } = vi.hoisted(() => ({ preparePrivateMedia: vi.fn() }));
vi.mock("@/lib/private-media", () => ({ preparePrivateMedia }));

import { AssetPreviewDialog } from "@/components/asset-preview-dialog";

const videoAsset: GeneratedAsset = {
  id: "asset-video",
  assetObjectId: "123e4567-e89b-42d3-a456-426614174010",
  mediaType: "video",
  title: "Campaign cut",
  description: null,
  prompt: null,
  mimeType: "video/webm",
  createdAt: "2026-11-13T00:00:00.000Z",
  url: "https://api.test/api/uploads/123e4567-e89b-42d3-a456-426614174010/file",
  published: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("asset preview dialog", () => {
  it("streams the authorized original video and exposes original download", async () => {
    preparePrivateMedia.mockResolvedValue({
      path: "https://api.test/api/uploads/123e4567-e89b-42d3-a456-426614174010/file",
      mimeType: "video/webm",
      byteSize: 5_000_000,
      expiresAt: null,
      grantSeconds: 300,
    });
    const onDownload = vi.fn();
    render(
      <AssetPreviewDialog
        asset={videoAsset}
        accessToken="session-token"
        onOpenChange={vi.fn()}
        onDownload={onDownload}
      />,
    );

    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.querySelector("video")).toHaveAttribute("src", expect.stringContaining("/api/uploads/")));
    const player = dialog.querySelector("video");
    if (!player) throw new Error("Authorized video player did not mount.");
    expect(player.tagName).toBe("VIDEO");
    expect(player).toHaveAttribute("controls");
    expect(player).toHaveAttribute("preload", "metadata");
    expect(player).toHaveAttribute("crossorigin", "use-credentials");
    expect(preparePrivateMedia).toHaveBeenCalledWith(
      videoAsset.assetObjectId,
      "session-token",
      expect.any(AbortSignal),
    );

    fireEvent.click(screen.getByRole("button", { name: "下载原文件" }));
    expect(onDownload).toHaveBeenCalledWith(videoAsset);
  });

  it("shows playback failure and reacquires the private grant on retry", async () => {
    preparePrivateMedia.mockResolvedValue({
      path: "https://api.test/api/uploads/123e4567-e89b-42d3-a456-426614174010/file",
      mimeType: "video/webm",
      byteSize: 5_000_000,
      expiresAt: null,
      grantSeconds: 300,
    });
    render(
      <AssetPreviewDialog
        asset={videoAsset}
        accessToken="session-token"
        onOpenChange={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.querySelector("video")).toHaveAttribute("src", expect.stringContaining("/api/uploads/")));
    const player = dialog.querySelector("video");
    if (!player) throw new Error("Authorized video player did not mount.");
    fireEvent.error(player);
    expect(await screen.findByRole("alert")).toHaveTextContent("视频暂时无法播放");
    fireEvent.click(screen.getByRole("button", { name: "重新读取预览" }));

    await waitFor(() => expect(preparePrivateMedia).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(dialog.querySelector("video")).toHaveAttribute("src", expect.stringContaining("/api/uploads/")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not let a canceled asset request overwrite the next preview", async () => {
    let settleFirst!: (value: { path: string; mimeType: string }) => void;
    preparePrivateMedia
      .mockImplementationOnce(() => new Promise((resolve) => { settleFirst = resolve; }))
      .mockResolvedValueOnce({
        path: "https://api.test/second.jpg",
        mimeType: "image/jpeg",
        byteSize: 100,
        expiresAt: null,
        grantSeconds: 300,
      });
    const nextAsset: GeneratedAsset = {
      ...videoAsset,
      id: "asset-image",
      assetObjectId: "123e4567-e89b-42d3-a456-426614174011",
      mediaType: "image",
      title: "Second asset",
      mimeType: "image/jpeg",
      url: "https://api.test/api/uploads/123e4567-e89b-42d3-a456-426614174011/file",
    };
    const view = render(
      <AssetPreviewDialog
        asset={videoAsset}
        accessToken="session-token"
        onOpenChange={vi.fn()}
        onDownload={vi.fn()}
      />,
    );
    view.rerender(
      <AssetPreviewDialog
        asset={nextAsset}
        accessToken="session-token"
        onOpenChange={vi.fn()}
        onDownload={vi.fn()}
      />,
    );
    await screen.findByAltText("Second asset");
    settleFirst({ path: "https://api.test/old.webm", mimeType: "video/webm" });

    await waitFor(() => expect(screen.getByAltText("Second asset")).toHaveAttribute("src", "https://api.test/second.jpg"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
