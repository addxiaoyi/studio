import { mkdtemp, realpath, rename, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requiredPreviewFreeBytes, VideoExportPreviews } from "./video-export-preview.js";

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "helstera-preview-"));
  directories.push(directory);
  const path = join(directory, "video.mp4");
  await writeFile(path, "original");
  return { directory, path };
}
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("export preview access", () => {
  it("reserves a bounded amount of local space before proxy generation", () => {
    expect(requiredPreviewFreeBytes(1)).toBe(512 * 1024 * 1024);
    expect(requiredPreviewFreeBytes(10 * 1024 * 1024 * 1024)).toBe(512 * 1024 * 1024);
  });

  it("only reads exports registered by the desktop process", async () => {
    const { path } = await fixture();
    const previews = new VideoExportPreviews();
    const id = await previews.register(path);
    expect(Buffer.from(await previews.read(id)).toString()).toBe("original");
    await expect(previews.read(path)).rejects.toThrow("no longer available");
  });

  it("rejects a file replaced after export", async () => {
    const { directory, path } = await fixture();
    const previews = new VideoExportPreviews();
    const id = await previews.register(path);
    await rename(path, join(directory, "old.mp4"));
    await writeFile(path, "changed!");
    await expect(previews.read(id)).rejects.toThrow("changed");
  });

  it("uses a bounded proxy for large exports instead of reading the 4K source", async () => {
    const { path } = await fixture();
    await truncate(path, 65 * 1024 * 1024);
    const renderPreview = async (sourcePath: string, previewPath: string) => {
      expect(sourcePath).toBe(path);
      await writeFile(previewPath, "proxy-video");
    };
    const previews = new VideoExportPreviews(undefined, undefined, renderPreview);
    const id = await previews.register(path);

    expect(Buffer.from(await previews.read(id)).toString()).toBe("proxy-video");
  });

  it("forwards cancellation to proxy rendering and removes the partial preview", async () => {
    const { path } = await fixture();
    await truncate(path, 65 * 1024 * 1024);
    const controller = new AbortController();
    let started!: () => void;
    const renderStarted = new Promise<void>(resolve => { started = resolve; });
    const renderPreview = async (_source: string, _preview: string, _report: unknown, signal: AbortSignal) => {
      started();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true });
      });
    };
    const previews = new VideoExportPreviews(undefined, undefined, renderPreview);
    const pending = previews.register(path, controller.signal);
    await renderStarted;
    controller.abort();
    await expect(pending).rejects.toThrow("low-resolution preview");
  });

  it("restores exports after restart only within the currently selected folder", async () => {
    const { directory } = await fixture();
    const store = join(directory, "history");
    const path = join(directory, "video-export-123e4567-e89b-42d3-a456-426614174000.mp4");
    await writeFile(path, "restorable");
    const first = new VideoExportPreviews(store, async () => directory);
    const id = await first.register(path);
    const restarted = new VideoExportPreviews(store, async () => directory);
    expect(await restarted.list()).toEqual([expect.objectContaining({ id, path: await realpath(path) })]);
    expect(Buffer.from(await restarted.read(id)).toString()).toBe("restorable");
    const other = await mkdtemp(join(tmpdir(), "helstera-preview-other-"));
    directories.push(other);
    const switched = new VideoExportPreviews(store, async () => other);
    expect(await switched.list()).toEqual([]);
    await expect(switched.read(id)).rejects.toThrow("outside the current local asset folder");
    await expect(restarted.read("../other")).rejects.toThrow("no longer available");
  });
});
