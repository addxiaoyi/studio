// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedRecording } from "@/components/chat/authenticated-recording";

vi.mock("@/lib/env", () => ({ getServerBaseUrl: () => "https://api.example.test" }));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("authenticated recording preview", () => {
  it("times out a stalled stream and reacquires access before retrying from the same position",async()=>{
    vi.useFakeTimers();
    const assetId="123e4567-e89b-42d3-a456-426614174000";
    const fetchVideo=vi.fn().mockImplementation(async()=>Response.json({ok:true,data:{path:`/api/uploads/${assetId}/file`,mimeType:"video/webm",byteSize:90*1024*1024,expiresAt:null,grantSeconds:300}}));
    vi.stubGlobal("fetch",fetchVideo);
    render(<AuthenticatedRecording assetId={assetId} accessToken="owner"/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    const video=screen.getByLabelText("网站浏览录屏") as HTMLVideoElement;
    video.currentTime=12;fireEvent.loadedMetadata(video);fireEvent.waiting(video);
    await act(async()=>{await vi.advanceTimersByTimeAsync(30001);});
    expect(screen.getByRole("alert")).toHaveTextContent("缓冲超时");
    fireEvent.click(screen.getByRole("button",{name:"重试加载"}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    expect(fetchVideo).toHaveBeenCalledTimes(2);
    const resumed=screen.getByLabelText("网站浏览录屏") as HTMLVideoElement;
    fireEvent.loadedMetadata(resumed);expect(resumed.currentTime).toBe(12);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("uses a private streaming source without buffering the file", async () => {
    const assetId = "123e4567-e89b-42d3-a456-426614174000";
    const fetchVideo = vi.fn().mockResolvedValue(Response.json({ok:true,data:{path:`/api/uploads/${assetId}/file`,mimeType:"video/webm",byteSize:90*1024*1024,expiresAt:null,grantSeconds:300}}));
    const createObjectURL = vi.fn(() => "blob:recording");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("fetch", fetchVideo);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const view = render(<AuthenticatedRecording assetId={assetId} accessToken="test-token" />);
    expect(await screen.findByLabelText("网站浏览录屏")).toHaveAttribute("src", `https://api.example.test/api/uploads/${assetId}/file`);
    expect(fetchVideo).toHaveBeenCalledWith(`https://api.example.test/api/uploads/${assetId}/playback`, expect.objectContaining({ method:"POST", credentials:"include", headers: { Authorization: "Bearer test-token" }, redirect: "error" }));
    expect(screen.getByRole("link",{name:"下载原始录像"})).toHaveAttribute("href",`https://api.example.test/api/uploads/${assetId}/file?download=1`);
    expect(createObjectURL).not.toHaveBeenCalled();
    view.unmount();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("does not send credentials for an invalid asset id", async () => {
    const fetchVideo = vi.fn();
    vi.stubGlobal("fetch", fetchVideo);
    render(<AuthenticatedRecording assetId="https://untrusted.example/video" accessToken="test-token" />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("录屏素材标识无效"));
    expect(fetchVideo).not.toHaveBeenCalled();
  });

  it("shows an error and does not create a preview when access is denied", async () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    render(<AuthenticatedRecording assetId="123e4567-e89b-42d3-a456-426614174000" accessToken="test-token" />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects an HTML fallback instead of treating it as video", async () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>", { headers: { "content-type": "text/html" } })));
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    render(<AuthenticatedRecording assetId="123e4567-e89b-42d3-a456-426614174000" accessToken="test-token" />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("aborts an in-flight request when the preview is removed", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => {
      signal = options.signal ?? undefined;
      return new Promise<Response>(() => {});
    }));
    const view = render(<AuthenticatedRecording assetId="123e4567-e89b-42d3-a456-426614174000" accessToken="test-token" />);
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
