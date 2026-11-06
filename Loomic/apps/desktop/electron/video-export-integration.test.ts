import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildVideoExportArgs } from "./video-export-plan.js";
import { resolveVideoExportClips } from "./video-export-assets.js";
import { probeVideo } from "./video-probe.js";
import { exportVideo } from "./video-export.js";
import { createVideoExportHandler } from "./video-export-handler.js";

const execFileAsync = promisify(execFile);
const executable = process.env.HELT_TEST_FFMPEG;
const probe = process.env.HELT_TEST_FFPROBE;
const fixtureEncoder = process.env.HELT_TEST_FIXTURE_FFMPEG ?? executable;

describe.skipIf(!executable || !probe)("video export with real FFmpeg", () => {
  it("exports a WebM recording without container duration metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "helstera-live-webm-"));
    try {
      const source = join(directory, "recording.webm");
      await execFileAsync(fixtureEncoder!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10:duration=1", "-c:v", "libvpx", "-live", "1", source]);
      const metadata = await execFileAsync(probe!, ["-v", "error", "-show_entries", "format=duration", "-of", "json", source]);
      expect(JSON.parse(metadata.stdout).format.duration).toBeUndefined();
      const info = await probeVideo(probe!, source, "matroska");
      expect(info.durationMs).toBeGreaterThanOrEqual(900);
      const bytes = await readFile(source);
      const handler = createVideoExportHandler({
        assetDirectory: async () => directory,
        checkTools: async () => {},
        confirm: async () => true,
        inspect: (path, format) => probeVideo(probe!, path, format),
        render: async (args) => { await execFileAsync(executable!, [...args], { timeout: 60_000 }); },
      });
      const output = await handler({ format: "portrait", clips: [{ name: "recording.webm", mimeType: "video/webm", bytes: Uint8Array.from(bytes).buffer, startMs: 0, endMs: 900 }] });
      expect(output).not.toBeNull();
      const decoded = await execFileAsync(executable!, ["-hide_banner", "-i", output!.path, "-map", "0:v:0", "-f", "null", "-"], { timeout: 30_000 });
      expect(decoded.stderr).toContain("720x1280");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 90_000);

  it("exports trimmed audio and silent clips to a playable MP4", async () => {
    const directory = await mkdtemp(join(tmpdir(), "helstera-video-export-"));
    const first = join(directory, "with-audio.mp4");
    const second = join(directory, "silent.mp4");
    const output = join(directory, "export.mp4");
    try {
      await execFileAsync(executable!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-c:v", "libx264", "-c:a", "aac", first]);
      await execFileAsync(executable!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=90x160:rate=30", "-t", "1", "-c:v", "libx264", second]);
      const firstId = "123e4567-e89b-42d3-a456-426614174000";
      const secondId = "123e4567-e89b-42d3-a456-426614174001";
      const clips = await resolveVideoExportClips({
        projectId: "123e4567-e89b-42d3-a456-426614174002", title: "Test", revision: 1, updatedAt: "2026-01-01T00:00:00.000Z",
        assets: [{ assetId: firstId, path: first, mimeType: "video/mp4", durationMs: 1000 }, { assetId: secondId, path: second, mimeType: "video/mp4", durationMs: 1000 }],
        clips: [{ clipId: "first", assetId: firstId, startMs: 100, endMs: 600, track: 0 }, { clipId: "second", assetId: secondId, startMs: 0, endMs: 500, track: 0 }], actions: [],
      }, directory, (path, format) => probeVideo(probe!, path, format));
      expect(clips.map((clip) => clip.hasAudio)).toEqual([true, false]);
      const args = buildVideoExportArgs(clips, output, "portrait");
      await execFileAsync(executable!, args, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      expect((await stat(output)).size).toBeGreaterThan(1_000);
      const decoded = await execFileAsync(executable!, ["-hide_banner", "-i", output, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], { timeout: 30_000 });
      expect(decoded.stderr).toContain("720x1280");
      expect(decoded.stderr).toContain("Audio:");
      expect(decoded.stderr).toMatch(/Duration: 00:00:01\./);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 90_000);

  it("rejects a playlist masquerading as a video", async () => {
    const directory = await mkdtemp(join(tmpdir(), "helstera-video-probe-"));
    try {
      const path = join(directory, "disguised.mp4");
      await writeFile(path, "#EXTM3U\n#EXTINF:1,\nfile:///secret.mp4\n");
      await expect(probeVideo(probe!, path, "mov")).rejects.toThrow("Could not inspect");
      await expect(probeVideo(probe!, path, "matroska")).rejects.toThrow("Could not inspect");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("confirms, renders and publishes a playable video through the export service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "helstera-video-service-"));
    try {
      const source = join(directory, "source.mp4");
      await execFileAsync(executable!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30", "-t", "1", "-c:v", "libx264", source]);
      const assetId = "123e4567-e89b-42d3-a456-426614174000";
      const output = await exportVideo({
        project: {
          projectId: "123e4567-e89b-42d3-a456-426614174001", title: "Test", revision: 1, updatedAt: "2026-01-01T00:00:00.000Z",
          assets: [{ assetId, path: source, mimeType: "video/mp4", durationMs: 1000 }],
          clips: [{ clipId: "clip", assetId, startMs: 0, endMs: 500, track: 0 }], actions: [],
        },
        assetDirectory: directory,
        format: "portrait",
        inspect: (path, format) => probeVideo(probe!, path, format),
        confirm: async () => true,
        render: async (args) => { await execFileAsync(executable!, [...args], { timeout: 60_000 }); },
      });
      expect(output).not.toBeNull();
      const decoded = await execFileAsync(executable!, ["-hide_banner", "-i", output!.path, "-map", "0:v:0", "-f", "null", "-"], { timeout: 30_000 });
      expect(decoded.stderr).toContain("720x1280");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 90_000);

  it("exports a real clip through the desktop request handler", async () => {
    const directory = await mkdtemp(join(tmpdir(), "helstera-video-handler-"));
    try {
      const source = join(directory, "source.mp4");
      await execFileAsync(executable!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30", "-t", "1", "-c:v", "libx264", source]);
      const bytes = await readFile(source);
      const handler = createVideoExportHandler({
        assetDirectory: async () => directory,
        checkTools: async () => {},
        confirm: async () => true,
        inspect: (path, format) => probeVideo(probe!, path, format),
        render: async (args) => { await execFileAsync(executable!, [...args], { timeout: 60_000 }); },
      });
      const output = await handler({ format: "portrait", clips: [{ name: "source.mp4", mimeType: "video/mp4", bytes: Uint8Array.from(bytes).buffer, startMs: 0, endMs: 500 }] });
      expect(output).not.toBeNull();
      const decoded = await execFileAsync(executable!, ["-hide_banner", "-i", output!.path, "-map", "0:v:0", "-f", "null", "-"], { timeout: 30_000 });
      expect(decoded.stderr).toContain("720x1280");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 90_000);
});
