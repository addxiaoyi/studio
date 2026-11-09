import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCanvasAssetImport } from "@/hooks/use-canvas-asset-import";
import { importCanvasAsset } from "@/lib/canvas-asset-import";

const media = vi.hoisted(() => ({ describe: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/canvas-media-file", () => ({
  inspectCanvasMedia: media.describe,
  readCanvasAsset: media.read,
}));
vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (elements: unknown[]) => elements,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const assetId = "22222222-2222-4222-8222-222222222222";
function fixture() {
  let elements: Record<string, any>[] = [];
  const api = {
    getSceneElements: () => elements,
    getAppState: () => ({
      scrollX: -1000,
      scrollY: -500,
      width: 800,
      height: 600,
      zoom: { value: 2 },
    }),
    addFiles: vi.fn(),
    scrollToContent: vi.fn(),
    updateScene: vi.fn((scene: { elements?: Record<string, any>[] }) => {
      if (scene.elements) elements = scene.elements;
    }),
  };
  media.read.mockResolvedValue({
    assetId,
    libraryAssetId: "11111111-1111-4111-8111-111111111111",
    title: "试穿结果",
    file: new File(["image"], "out.png", { type: "image/png" }),
  });
  media.describe.mockResolvedValue({
    width: 1200,
    height: 1800,
    duration: 0,
    dataUrl: "data:image/png;base64,dGVzdA==",
  });
  return api;
}
it("waits for canvas hydration and exposes failure with an explicit retry", async () => {
  const api = fixture();
  media.read.mockRejectedValueOnce(new Error("素材已过期"));
  const { result, rerender } = renderHook(
    ({ ready }) =>
      useCanvasAssetImport({
        api,
        ready,
        assetId,
        token: "token",
        canvasId: "canvas",
      }),
    { initialProps: { ready: false } },
  );
  expect(media.read).not.toHaveBeenCalled();
  rerender({ ready: true });
  await waitFor(() => expect(result.current.error).toBe("素材已过期"));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.status).toBe("imported"));
  expect(api.getSceneElements()).toHaveLength(1);
});
it("retains source identity, centers the image and deduplicates after remount", async () => {
  const api = fixture(),
    signal = new AbortController().signal;
  await importCanvasAsset(api, "token", assetId, signal);
  const element = api.getSceneElements()[0]!;
  expect(element.customData).toMatchObject({
    assetId,
    libraryAssetId: "11111111-1111-4111-8111-111111111111",
  });
  expect(element.x).toBeGreaterThan(0);
  expect(api.scrollToContent).toHaveBeenCalled();
  await importCanvasAsset(api, "token", assetId, signal);
  expect(api.getSceneElements()).toHaveLength(1);
  expect(media.read).toHaveBeenCalledOnce();
});
it("uses decoded video metadata and does not create an image data URL", async () => {
  const api = fixture();
  media.read.mockResolvedValue({
    assetId,
    libraryAssetId: assetId,
    title: "竖屏录像",
    file: new File(["video"], "out.webm", { type: "video/webm" }),
  });
  media.describe.mockResolvedValue({
    width: 720,
    height: 1280,
    duration: 125.5,
  });
  await importCanvasAsset(api, "token", assetId, new AbortController().signal);
  expect(api.addFiles).not.toHaveBeenCalled();
  expect(api.getSceneElements()[0]?.customData).toMatchObject({
    assetId,
    durationSeconds: 125.5,
    mediaWidth: 720,
    mediaHeight: 1280,
  });
});
it("does not insert a decoded asset after the original canvas was abandoned", async () => {
  const api = fixture(),
    abort = new AbortController();
  let finish!: (value: unknown) => void;
  media.describe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = importCanvasAsset(api, "token", assetId, abort.signal);
  await waitFor(() => expect(media.describe).toHaveBeenCalled());
  abort.abort();
  finish({
    width: 10,
    height: 10,
    duration: 0,
    dataUrl: "data:image/png;base64,aA==",
  });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(api.updateScene).not.toHaveBeenCalled();
});
