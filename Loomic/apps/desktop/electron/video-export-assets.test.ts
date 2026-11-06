import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoProject } from "@helstera/shared";
import { resolveVideoExportClips } from "./video-export-assets.js";

const directories: string[] = [];
const assetId = "123e4567-e89b-42d3-a456-426614174000";
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "helstera-export-assets-"));
  directories.push(directory);
  return directory;
}
function project(path: string): VideoProject {
  return {
    projectId: "123e4567-e89b-42d3-a456-426614174001", title: "Test", revision: 1, updatedAt: "2026-01-01T00:00:00.000Z",
    assets: [{ assetId, path, mimeType: "video/mp4", durationMs: 2000 }],
    clips: [{ clipId: "clip-1", assetId, startMs: 100, endMs: 1000, track: 0 }], actions: [],
  };
}
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("video export asset authorization", () => {
  it("resolves an in-directory video and uses inspected audio metadata", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "video.mp4");
    await writeFile(path, "test video");
    const canonicalPath = await realpath(path);
    const inspect = vi.fn().mockResolvedValue({ durationMs: 2000, hasAudio: true });
    const clips = await resolveVideoExportClips(project(path), root, inspect);
    expect(clips).toEqual([{ sourcePath: canonicalPath, inputFormat: "mov", startMs: 100, endMs: 1000, hasAudio: true }]);
    expect(inspect).toHaveBeenCalledExactlyOnceWith(canonicalPath, "mov");
  });

  it("rejects paths outside the selected folder and clips beyond actual duration", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const path = join(outside, "video.mp4");
    await writeFile(path, "test video");
    const inspect = vi.fn().mockResolvedValue({ durationMs: 500, hasAudio: false });
    await expect(resolveVideoExportClips(project(path), root, inspect)).rejects.toThrow("outside");
    await expect(resolveVideoExportClips(project(path), outside, inspect)).rejects.toThrow("beyond");
  });

  it("rejects symlinks escaping the selected directory", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const path = join(outside, "video.mp4");
    await writeFile(path, "test video");
    const link = join(root, "linked.mp4");
    try { await symlink(path, link); } catch (error) {
      if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    await expect(resolveVideoExportClips(project(link), root, vi.fn())).rejects.toThrow("outside");
  });

  it("rejects unsupported actions instead of silently omitting them", async () => {
    const root = await temporaryDirectory();
    const video = project(join(root, "video.mp4"));
    video.actions.push({ type: "caption", text: "hello", startMs: 0, endMs: 500 });
    await expect(resolveVideoExportClips(video, root, vi.fn())).rejects.toThrow("does not support");
  });
});
