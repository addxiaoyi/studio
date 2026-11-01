import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { resolveFfmpegPath, runFfmpeg } from "./media-renderer.js";

function fakeProcess() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe("media renderer", () => {
  it("resolves the packaged FFmpeg path per platform", () => {
    expect(resolveFfmpegPath("C:/resources", "win32").replaceAll("\\", "/")).toContain("ffmpeg/win-x64/ffmpeg.exe");
    expect(resolveFfmpegPath("/resources", "linux").replaceAll("\\", "/")).toContain("ffmpeg/linux-x64/ffmpeg");
  });

  it("returns output for a successful render", async () => {
    const child = fakeProcess();
    const promise = runFfmpeg(["-version"], {
      resourcesPath: "C:/resources",
      platform: "win32",
      spawnProcess: vi.fn(() => child) as never,
    });
    child.stderr.emit("data", "frame=1");
    child.emit("close", 0);
    await expect(promise).resolves.toMatchObject({ code: 0, stderr: "frame=1" });
  });

  it("cancels a running render", async () => {
    const child = fakeProcess();
    const controller = new AbortController();
    const promise = runFfmpeg([], {
      resourcesPath: "C:/resources",
      platform: "win32",
      signal: controller.signal,
      spawnProcess: vi.fn(() => child) as never,
    });
    controller.abort();
    await expect(promise).rejects.toThrow("canceled");
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
