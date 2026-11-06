import { mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VideoExportPreviews } from "./video-export-preview.js";

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
