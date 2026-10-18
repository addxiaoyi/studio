import { describe, expect, it, vi } from "vitest";
import type { ImageProvider, VideoProvider } from "./types.js";

const { imageProvider, videoProvider, getImageProviderMock, getVideoProviderMock } = vi.hoisted(() => ({
  imageProvider: { generate: vi.fn() } as unknown as ImageProvider,
  videoProvider: { generate: vi.fn() } as unknown as VideoProvider,
  getImageProviderMock: vi.fn(),
  getVideoProviderMock: vi.fn(),
}));

vi.mock("./providers/registry.js", () => ({
  getImageProvider: getImageProviderMock,
  getVideoProvider: getVideoProviderMock,
}));

import { generateImage } from "./image-generation.js";
import { generateVideo } from "./video-generation.js";

describe("generation wrapper retirement guards", () => {
  it("rejects retired image models before resolving a Provider", async () => {
    await expect(generateImage("fixture", { model: "doubao-seededit-3-0-i2i-250628", prompt: "x" }))
      .rejects.toMatchObject({ code: "model_not_found" });
    expect(getImageProviderMock).not.toHaveBeenCalled();
  });

  it("rejects retired video models before resolving a Provider", async () => {
    await expect(generateVideo("fixture", { model: "gk-video-3", prompt: "x", duration: 5 }))
      .rejects.toMatchObject({ code: "model_not_found" });
    expect(getVideoProviderMock).not.toHaveBeenCalled();
  });

  it("keeps active Provider calls unchanged", async () => {
    getImageProviderMock.mockReturnValue(imageProvider);
    getVideoProviderMock.mockReturnValue(videoProvider);
    vi.mocked(imageProvider.generate).mockResolvedValue({ url: "data:image/png;base64,AQID", mimeType: "image/png", width: 1, height: 1 });
    vi.mocked(videoProvider.generate).mockResolvedValue({ url: "https://video.test/out.mp4", mimeType: "video/mp4", width: 1280, height: 720, durationSeconds: 5 });

    await expect(generateImage("fixture", { model: "gpt-image-2", prompt: "x" })).resolves.toMatchObject({ mimeType: "image/png" });
    await expect(generateVideo("fixture", { model: "metaso/minimax-h3", prompt: "x", duration: 5 })).resolves.toMatchObject({ mimeType: "video/mp4" });
    expect(getImageProviderMock).toHaveBeenCalledWith("fixture");
    expect(getVideoProviderMock).toHaveBeenCalledWith("fixture");
  });
});
