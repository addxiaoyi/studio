import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoProject } from "@helstera/shared";
import { exportVideo } from "./video-export.js";

const directories: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "helstera-export-service-"));
  directories.push(root);
  const path = join(root, "source.mp4");
  await writeFile(path, "source");
  const assetId = "123e4567-e89b-42d3-a456-426614174000";
  const project: VideoProject = {
    projectId: "123e4567-e89b-42d3-a456-426614174001", title: "Test", revision: 1, updatedAt: "2026-01-01T00:00:00.000Z",
    assets: [{ assetId, path, mimeType: "video/mp4", durationMs: 2000 }],
    clips: [{ clipId: "clip", assetId, startMs: 0, endMs: 1000, track: 0 }], actions: [],
  };
  return { root, project };
}
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

describe("video export service", () => {
  const inspect = vi.fn(async () => ({ durationMs: 2000, hasAudio: false }));

  it("does not render or create output when confirmation is declined", async () => {
    const { root, project } = await fixture();
    const render = vi.fn();
    const confirm = vi.fn(async () => false);
    await expect(exportVideo({ project, assetDirectory: root, format: "portrait", inspect, confirm, render })).resolves.toBeNull();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 1000, clipCount: 1, format: "portrait" }));
    expect(render).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(["source.mp4"]);
  });

  it("publishes a verified output and removes the temporary directory", async () => {
    const { root, project } = await fixture();
    const render = vi.fn(async (args: readonly string[]) => { await writeFile(args[args.length - 1]!, "encoded video"); });
    const output = await exportVideo({ project, assetDirectory: root, format: "portrait", inspect, confirm: async () => true, render });
    expect(output?.path).toMatch(/video-export-.*\.mp4$/);
    expect(await readdir(root)).toHaveLength(2);
    expect(inspect).toHaveBeenCalledWith(expect.stringContaining("output.mp4"), "mov");
  });

  it("removes partial output after a render failure", async () => {
    const { root, project } = await fixture();
    const render = vi.fn(async (args: readonly string[]) => { await writeFile(args[args.length - 1]!, "partial"); throw new Error("render failed"); });
    await expect(exportVideo({ project, assetDirectory: root, format: "portrait", inspect, confirm: async () => true, render })).rejects.toThrow("render failed");
    expect(await readdir(root)).toEqual(["source.mp4"]);
  });

  it("rejects a source changed during confirmation without rendering", async () => {
    const { root, project } = await fixture();
    const render = vi.fn();
    const confirm = async () => { await writeFile(project.assets[0]!.path, "replacement"); return true; };
    await expect(exportVideo({ project, assetDirectory: root, format: "portrait", inspect, confirm, render })).rejects.toThrow("changed after confirmation");
    expect(render).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(["source.mp4"]);
  });

  it("renders from a snapshot even if the original changes after confirmation", async () => {
    const { root, project } = await fixture();
    const render = vi.fn(async (args: readonly string[]) => {
      expect(args[args.indexOf("-i") + 1]).not.toBe(project.assets[0]!.path);
      await writeFile(project.assets[0]!.path, "replacement");
      await writeFile(args[args.length - 1]!, "encoded video");
    });
    await expect(exportVideo({ project, assetDirectory: root, format: "portrait", inspect, confirm: async () => true, render })).resolves.not.toBeNull();
  });
});
