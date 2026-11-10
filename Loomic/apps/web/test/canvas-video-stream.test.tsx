// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VideoCanvasElement } from "@/components/canvas/video-canvas-element";
vi.mock("@/lib/env", () => ({ getServerBaseUrl: () => "https://api.test" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("streams restored videos over 250 MiB through a private grant without buffering", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174000", path = `/api/uploads/${id}/file`;
  const request = vi.fn().mockResolvedValue(Response.json({ ok: true, data: { path, byteSize: 300 * 1024 ** 2, mimeType: "video/mp4", expiresAt: null, grantSeconds: 300 } }));
  vi.stubGlobal("fetch", request);
  const view = render(<VideoCanvasElement src={path} width={640} height={360} accessToken="owner"/>);
  await waitFor(() => expect(view.container.querySelector("video")).toHaveAttribute("src", `https://api.test${path}`));
  expect(request).toHaveBeenCalledWith(`https://api.test/api/uploads/${id}/playback`, expect.objectContaining({ method: "POST", credentials: "include" }));
  expect(view.container.querySelector("video")).toHaveAttribute("crossorigin", "use-credentials");
});
