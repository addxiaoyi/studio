import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoExportHandler } from "./video-export-handler.js";

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "helstera-export-handler-"));
  directories.push(path);
  return path;
}
function request() {
  return { format: "portrait", clips: [{ name: "test.mp4", mimeType: "video/mp4", bytes: new Uint8Array([1, 2]).buffer, startMs: 0, endMs: 1000 }] };
}
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

describe("desktop video export handler", () => {
  it("does not stage files or render when confirmation is rejected", async () => {
    const root = await directory();
    const render = vi.fn();
    const handler = createVideoExportHandler({ assetDirectory: async () => root, checkTools: async () => {}, confirm: async () => false, inspect: vi.fn(), render });
    await expect(handler(request())).resolves.toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it("does not request confirmation or create files when the tools are missing", async () => {
    const root = await directory();
    const confirm = vi.fn();
    const handler = createVideoExportHandler({ assetDirectory: async () => root, checkTools: async () => { throw new Error("missing FFmpeg"); }, confirm, inspect: vi.fn(), render: vi.fn() });
    await expect(handler(request())).rejects.toThrow("missing FFmpeg");
    expect(confirm).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it("prevents concurrent exports and releases the lock on rejection", async () => {
    const root = await directory();
    let complete: (confirmed: boolean) => void = () => {};
    const confirmation = new Promise<boolean>((resolve) => { complete = resolve; });
    const confirm = vi.fn().mockReturnValueOnce(confirmation).mockResolvedValue(false);
    const handler = createVideoExportHandler({ assetDirectory: async () => root, checkTools: async () => {}, confirm, inspect: vi.fn(), render: vi.fn() });
    const first = handler(request());
    await expect(handler(request())).rejects.toThrow("already running");
    complete(false);
    await expect(first).resolves.toBeNull();
    await expect(handler(request())).resolves.toBeNull();
  });

  it("cleans staged inputs after successful export", async () => {
    const root = await directory();
    const handler = createVideoExportHandler({
      assetDirectory: async () => root, checkTools: async () => {}, confirm: async () => true,
      inspect: async () => ({ durationMs: 1500, hasAudio: false }),
      render: async (args) => { await writeFile(args[args.length - 1]!, "encoded"); },
    });
    const output = await handler(request());
    expect(output?.path).toMatch(/video-export-.*\.mp4$/);
    expect(await readdir(root)).toHaveLength(1);
  });
});
