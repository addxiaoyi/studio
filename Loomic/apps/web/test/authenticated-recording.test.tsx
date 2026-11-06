// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedRecording } from "@/components/chat/authenticated-recording";

vi.mock("@/lib/env", () => ({ getServerBaseUrl: () => "https://api.example.test" }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("authenticated recording preview", () => {
  it("loads the trusted asset with a bearer token and releases the preview", async () => {
    const fetchVideo = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/webm" } }));
    const createObjectURL = vi.fn(() => "blob:recording");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("fetch", fetchVideo);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const assetId = "123e4567-e89b-42d3-a456-426614174000";
    const view = render(<AuthenticatedRecording assetId={assetId} accessToken="test-token" />);
    expect(await screen.findByLabelText("网站浏览录屏")).toHaveAttribute("src", "blob:recording");
    expect(fetchVideo).toHaveBeenCalledWith(`https://api.example.test/api/uploads/${assetId}/file`, expect.objectContaining({ headers: { Authorization: "Bearer test-token" }, redirect: "error" }));
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:recording");
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
