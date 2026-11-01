import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

export type FfmpegPlatform = "win32" | "darwin" | "linux";

export type FfmpegOptions = {
  resourcesPath?: string;
  platform?: FfmpegPlatform;
  timeoutMs?: number;
  signal?: AbortSignal;
  spawnProcess?: typeof spawn;
};

export type FfmpegResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

function binaryName(platform: FfmpegPlatform) {
  return platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

export function resolveFfmpegPath(resourcesPath: string, platform: FfmpegPlatform = process.platform as FfmpegPlatform) {
  const folder = platform === "win32" ? "win-x64" : platform === "darwin" ? `mac-${process.arch === "arm64" ? "arm64" : "x64"}` : "linux-x64";
  return join(resourcesPath, "ffmpeg", folder, binaryName(platform));
}

export async function assertFfmpegAvailable(path: string) {
  try {
    await access(path);
  } catch (error) {
    throw new Error(`FFmpeg is not available at ${path}.`, { cause: error });
  }
  return path;
}

export function runFfmpeg(args: readonly string[], options: FfmpegOptions = {}): Promise<FfmpegResult> {
  const timeoutMs = Math.min(30 * 60_000, Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const spawnProcess = options.spawnProcess ?? spawn;
  const path = resolveFfmpegPath(options.resourcesPath ?? process.resourcesPath, options.platform ?? (process.platform as FfmpegPlatform));

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnProcess(path, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(new Error("FFmpeg could not be started.", { cause: error }));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`FFmpeg timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    const abort = () => {
      child.kill();
      finish(new Error("FFmpeg export was canceled."));
    };
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });

    child.stdout?.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });
    child.once("error", (error) => finish(new Error("FFmpeg failed to run.", { cause: error })));
    child.once("close", (code) => {
      if (code === 0) finish(null, { code: 0, stdout, stderr });
      else finish(new Error(`FFmpeg exited with code ${code ?? "unknown"}: ${stderr.trim() || "no error output"}`));
    });

    function finish(error: Error | null, result?: FfmpegResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result!);
    }
  });
}
