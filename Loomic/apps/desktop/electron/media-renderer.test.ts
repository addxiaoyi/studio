import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { assertVideoEncoders, assertVideoTools, resolveFfmpegPath, runFfmpeg } from "./media-renderer.js";

function fakeProcess() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe("media renderer", () => {
  it("requires real x264 and AAC encoder entries", () => {
    expect(() => assertVideoEncoders(" V....D libx264 H.264 encoder\n A..... aac AAC encoder\n")).not.toThrow();
    expect(() => assertVideoEncoders(" V..... libx264rgb H.264\n A..... aac AAC\n")).toThrow("libx264");
    expect(() => assertVideoEncoders(" V....D libx264 H.264\n A..... aac_fixed AAC\n")).toThrow("aac");
  });

  it("fails before probing when packaged tools are missing", async () => {
    await expect(assertVideoTools("missing-ffmpeg", "missing-ffprobe")).rejects.toThrow("not available");
  });

  it("rejects existing executables that cannot run the requested probe", async () => {
    await expect(assertVideoTools(process.execPath, process.execPath)).rejects.toThrow("could not be started");
  }, 30_000);

  it.skipIf(!process.env.HELT_TEST_FFMPEG || !process.env.HELT_TEST_FFPROBE)("accepts real FFmpeg and FFprobe with required encoders", async () => {
    await expect(assertVideoTools(process.env.HELT_TEST_FFMPEG!, process.env.HELT_TEST_FFPROBE!)).resolves.toBeUndefined();
  }, 30_000);

  it.skipIf(!process.env.HELT_TEST_FFMPEG)("does not accept FFmpeg in place of FFprobe", async () => {
    await expect(assertVideoTools(process.env.HELT_TEST_FFMPEG!, process.env.HELT_TEST_FFMPEG!)).rejects.toThrow("requires FFprobe");
  }, 30_000);

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
    let settled = false;
    void promise.catch(() => { settled = true; });
    controller.abort();
    expect(child.kill).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit("close", null);
    await expect(promise).rejects.toThrow("canceled");
  });

  it("does not spawn when already canceled", async () => {
    const controller = new AbortController();
    controller.abort();
    const spawnProcess = vi.fn();
    await expect(runFfmpeg([], { signal: controller.signal, spawnProcess: spawnProcess as never })).rejects.toThrow("canceled");
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("keeps only bounded recent output", async () => {
    const child = fakeProcess();
    const promise = runFfmpeg([], { resourcesPath: "C:/resources", spawnProcess: vi.fn(() => child) as never });
    child.stderr.emit("data", "x".repeat(100_000) + "last frame");
    child.emit("close", 0);
    const response = await promise;
    expect(response.stderr.length).toBe(64 * 1024);
    expect(response.stderr.endsWith("last frame")).toBe(true);
  });
});
