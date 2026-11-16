// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VideoCanvasElement } from "@/components/canvas/video-canvas-element";
import { CanvasTimelinePreview } from "@/components/canvas/timeline-preview";
vi.mock("@/lib/env", () => ({ getServerBaseUrl: () => "https://api.test" }));
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("streams restored videos over 250 MiB through a private grant without buffering", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174000", path = `/api/uploads/${id}/file`;
  const request = vi.fn().mockResolvedValue(Response.json({ ok: true, data: { path, byteSize: 300 * 1024 ** 2, mimeType: "video/mp4", expiresAt: null, grantSeconds: 300 } }));
  vi.stubGlobal("fetch", request);
  const view = render(<VideoCanvasElement src={path} width={640} height={360} accessToken="owner"/>);
  await waitFor(() => expect(view.container.querySelector("video")).toHaveAttribute("src", `https://api.test${path}`));
  expect(request).toHaveBeenCalledWith(`https://api.test/api/uploads/${id}/playback`, expect.objectContaining({ method: "POST", credentials: "include" }));
  expect(view.container.querySelector("video")).toHaveAttribute("crossorigin", "use-credentials");
});

it("uses the private playback grant for timeline previews instead of buffering the whole asset", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174001";
  const request = vi.fn().mockResolvedValue(Response.json({ ok: true, data: {
    path: `/api/uploads/${id}/file`,
    byteSize: 800 * 1024 * 1024,
    mimeType: "video/mp4",
    expiresAt: null,
    grantSeconds: 300,
  } }));
  vi.stubGlobal("fetch", request);
  const view = render(
    <CanvasTimelinePreview
      token="owner"
      timeline={{
        version: 1,
        canvasId: "canvas-1",
        format: "landscape",
        duration: 12,
        items: [{
          id: "video-1",
          title: "Long video",
          kind: "video",
          assetId: id,
          duration: 12,
          start: 0,
          trimStart: 0,
          trimEnd: 12,
          volume: 1,
        }],
      }}
    />,
  );
  const video = await waitFor(() => {
    const element = view.container.querySelector("video");
    expect(element).toHaveAttribute("src", `https://api.test/api/uploads/${id}/file`);
    expect(element).toHaveAttribute("crossorigin", "use-credentials");
    return element;
  });
  expect(video).toBeTruthy();
  expect(request).toHaveBeenCalledWith(`https://api.test/api/uploads/${id}/playback`, expect.objectContaining({ method: "POST", credentials: "include" }));
});

it("renews the private playback grant when a timeline preview is retried", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174002";
  const request = vi.fn()
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true, data: {
      path: `/api/uploads/${id}/file`,
      byteSize: 1024,
      mimeType: "video/mp4",
      expiresAt: null,
      grantSeconds: 300,
    } }));
  vi.stubGlobal("fetch", request);
  const view = render(
    <CanvasTimelinePreview
      token="owner"
      timeline={{
        version: 1,
        canvasId: "canvas-retry",
        format: "landscape",
        duration: 12,
        items: [{
          id: "video-retry",
          title: "Retry video",
          kind: "video",
          assetId: id,
          duration: 12,
          start: 0,
          trimStart: 0,
          trimEnd: 12,
          volume: 1,
        }],
      }}
    />,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
  fireEvent.click(screen.getByRole("button", { name: "重新获取预览" }));

  await waitFor(() => {
    expect(view.container.querySelector("video")).toHaveAttribute(
      "src",
      `https://api.test/api/uploads/${id}/file`,
    );
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
});

it("reissues a private playback grant after the timeline video itself fails", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174003";
  const request = vi.fn().mockImplementation(() => Response.json({ ok: true, data: {
    path: `/api/uploads/${id}/file`,
    byteSize: 1024,
    mimeType: "video/mp4",
    expiresAt: null,
    grantSeconds: 300,
  } }));
  vi.stubGlobal("fetch", request);
  const view = render(
    <CanvasTimelinePreview
      token="owner"
      timeline={{
        version: 1,
        canvasId: "canvas-stream-retry",
        format: "landscape",
        duration: 12,
        items: [{
          id: "video-stream-retry",
          title: "Stream retry video",
          kind: "video",
          assetId: id,
          duration: 12,
          start: 0,
          trimStart: 0,
          trimEnd: 12,
          volume: 1,
        }],
      }}
    />,
  );

  const firstPlayer = await waitFor(() => {
    const player = view.container.querySelector("video");
    expect(player).toHaveAttribute("src", `https://api.test/api/uploads/${id}/file`);
    return player;
  });
  if (!firstPlayer) throw new Error("Timeline preview did not mount its video player.");
  fireEvent.error(firstPlayer);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新获取预览" }));

  await waitFor(() => {
    const player = view.container.querySelector("video");
    expect(player).not.toBe(firstPlayer);
    expect(player).toHaveAttribute("src", `https://api.test/api/uploads/${id}/file`);
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
});

it("renews the matching private playback grant when a timeline audio track fails", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174004";
  const request = vi.fn()
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true, data: {
      path: `/api/uploads/${id}/file`,
      byteSize: 1024,
      mimeType: "audio/mpeg",
      expiresAt: null,
      grantSeconds: 300,
    } }));
  vi.stubGlobal("fetch", request);
  const view = render(
    <CanvasTimelinePreview
      token="owner"
      timeline={{
        version: 1,
        canvasId: "canvas-audio-retry",
        format: "landscape",
        duration: 12,
        items: [{
          id: "audio-retry",
          title: "Music track",
          kind: "audio",
          assetId: id,
          duration: 12,
          start: 0,
          trimStart: 0,
          trimEnd: 12,
          volume: 1,
        }],
      }}
    />,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
  fireEvent.click(screen.getByRole("button", { name: "重新获取预览" }));

  await waitFor(() => {
    expect(view.container.querySelector("audio")).toHaveAttribute(
      "src",
      `https://api.test/api/uploads/${id}/file`,
    );
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
});

it("renews the private playback grant when browser playback is rejected", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174005";
  const request = vi.fn().mockImplementation(() => Response.json({ ok: true, data: {
    path: `/api/uploads/${id}/file`,
    byteSize: 1024,
    mimeType: "video/mp4",
    expiresAt: null,
    grantSeconds: 300,
  } }));
  vi.stubGlobal("fetch", request);
  vi.spyOn(HTMLMediaElement.prototype, "play")
    .mockRejectedValueOnce(new Error("playback blocked"))
    .mockResolvedValue(undefined);
  const view = render(
    <CanvasTimelinePreview
      token="owner"
      timeline={{
        version: 1,
        canvasId: "canvas-play-retry",
        format: "landscape",
        duration: 12,
        items: [{
          id: "video-play-retry",
          title: "Playback retry video",
          kind: "video",
          assetId: id,
          duration: 12,
          start: 0,
          trimStart: 0,
          trimEnd: 12,
          volume: 1,
        }],
      }}
    />,
  );

  await waitFor(() => expect(view.container.querySelector("video")).toHaveAttribute(
    "src",
    `https://api.test/api/uploads/${id}/file`,
  ));
  fireEvent.click(screen.getByRole("button", { name: "播放预览" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("视频无法播放");
  fireEvent.click(screen.getByRole("button", { name: "重新获取预览" }));

  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("surfaces and retries a timeline audio element load failure", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174006";
  const request = vi.fn().mockImplementation(() => Response.json({ ok: true, data: {
    path: `/api/uploads/${id}/file`,
    byteSize: 1024,
    mimeType: "audio/mpeg",
    expiresAt: null,
    grantSeconds: 300,
  } }));
  vi.stubGlobal("fetch", request);
  const view = render(
    <CanvasTimelinePreview
      token="owner"
      timeline={{
        version: 1,
        canvasId: "canvas-audio-element-retry",
        format: "landscape",
        duration: 12,
        items: [{
          id: "audio-element-retry",
          title: "Audio retry track",
          kind: "audio",
          assetId: id,
          duration: 12,
          start: 0,
          trimStart: 0,
          trimEnd: 12,
          volume: 1,
        }],
      }}
    />,
  );

  const audio = await waitFor(() => {
    const element = view.container.querySelector("audio");
    expect(element).toHaveAttribute("src", `https://api.test/api/uploads/${id}/file`);
    return element;
  });
  if (!audio) throw new Error("Timeline preview did not mount its audio player.");
  fireEvent.error(audio);
  expect(await screen.findByRole("alert")).toHaveTextContent("音频无法读取");
  fireEvent.click(screen.getByRole("button", { name: "重新获取预览" }));

  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
