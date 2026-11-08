// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VideoActionsToolbar } from "@/components/canvas/video-actions-toolbar";
import { CanvasVideoImport } from "@/components/capture-recording-import";

const assetId = "b631fca5-4acb-4143-a58c-c28a5fc10bda";
vi.mock("@/lib/server-api", () => ({ fetchWebsiteCapture: vi.fn() }));
vi.mock("@/lib/studio-media", () => ({ readStudioAsset: vi.fn(async () => new File(["video"], `${assetId}.webm`, { type: "video/webm" })) }));
vi.mock("@/lib/studio-video-metadata", () => ({ studioVideoDuration: vi.fn(async () => 12) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

it("offers keyboard-addressable timeline and AI actions above the drawing surface", () => {
  const root = document.createElement("div");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) });
  const api = { getSceneElements: () => [{ id: "video-1", x: 100, y: 100, width: 400, height: 225, customData: { isVideo: true } }], getAppState: () => ({ selectedElementIds: { "video-1": true } }), onChange: () => () => {} };
  const action = vi.fn();
  render(<VideoActionsToolbar api={api} root={{ current: root }} onAction={action} />);
  fireEvent.click(screen.getByRole("button", { name: "加入时间线" }));
  fireEvent.click(screen.getByRole("button", { name: "让 AI 剪辑" }));
  expect(action.mock.calls).toEqual([["video-1", "timeline"], ["video-1", "ai"]]);
});

it("retains the canvas trim and adds one persistent clip only after the user confirms", async () => {
  window.history.replaceState(null, "", `/video/?assetId=${assetId}&start=2&end=8&edit=1`);
  let file: File | null = null, cut: any = null;
  const runtime = { readAsset: vi.fn(async () => file), importAsset: vi.fn(async (next: File) => { file = next; }), readCut: () => cut, applyCut: vi.fn(async (next: unknown) => { cut = next; }) };
  const props = { runtime: runtime as never, token: "token", onImported: vi.fn() };
  const view = render(<CanvasVideoImport {...props} />);
  const add = await screen.findByRole("button", { name: "加入剪辑时间线" });
  expect(runtime.applyCut).not.toHaveBeenCalled();
  fireEvent.click(add);
  await waitFor(() => expect(runtime.applyCut).toHaveBeenCalledOnce());
  expect(cut.clips).toEqual([expect.objectContaining({ id: `canvas-${assetId}`, start: 2, end: 8, duration: 12 })]);
  view.unmount(); render(<CanvasVideoImport {...props} />);
  expect(await screen.findByRole("button", { name: "让 AI 剪辑" })).toBeInTheDocument();
  expect(runtime.applyCut).toHaveBeenCalledOnce(); expect(runtime.importAsset).toHaveBeenCalledOnce();
});
