import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

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
const MAX_OUTPUT_CHARS = 64 * 1024;
const runProbe = promisify(execFile);

function appendOutput(previous: string, chunk: Buffer | string): string {
  return (previous + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
}

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

export function assertVideoEncoders(encoders: string) {
  for (const name of ["libx264", "aac"]) {
    if (!new RegExp(`^\\s*[A-Z.]{6}\\s+${name}\\s`, "m").test(encoders)) {
      throw new Error(`Video export requires the ${name} encoder. Reinstall the desktop application.`);
    }
  }
}

export async function assertVideoTools(ffmpeg: string, ffprobe: string) {
  await Promise.all([assertFfmpegAvailable(ffmpeg), assertFfmpegAvailable(ffprobe)]);
  const options = { timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true };
  let encoders: string;
  let probeVersion: string;
  try {
    const [encoderList, probeInfo] = await Promise.all([
      runProbe(ffmpeg, ["-hide_banner", "-encoders"], options),
      runProbe(ffprobe, ["-version"], options),
    ]);
    encoders = encoderList.stdout;
    probeVersion = probeInfo.stdout;
  } catch (error) {
    throw new Error("Video export tools could not be started. Reinstall the desktop application.", { cause: error });
  }
  if (!/^ffprobe version\s/m.test(probeVersion)) {
    throw new Error("Video export requires FFprobe. Reinstall the desktop application.");
  }
  assertVideoEncoders(encoders);
}

export function runFfmpeg(args: readonly string[], options: FfmpegOptions = {}): Promise<FfmpegResult> {
  if (options.signal?.aborted) return Promise.reject(new Error("FFmpeg export was canceled."));
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
    let stopError: Error | undefined;
    const stop = (error: Error) => {
      if (stopError || settled) return;
      stopError = error;
      child.kill();
    };
    const timer = setTimeout(() => stop(new Error(`FFmpeg timed out after ${timeoutMs} ms.`)), timeoutMs);

    const abort = () => {
      stop(new Error("FFmpeg export was canceled."));
    };
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });

    child.stdout?.on("data", (chunk: Buffer | string) => { stdout = appendOutput(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer | string) => { stderr = appendOutput(stderr, chunk); });
    const events = child as ChildProcess & {
      once(event: "error", listener: (error: Error) => void): void;
      once(event: "close", listener: (code: number | null) => void): void;
    };
    events.once("error", (error) => finish(new Error("FFmpeg failed to run.", { cause: error })));
    events.once("close", (code) => {
      if (stopError) finish(stopError);
      else if (code === 0) finish(null, { code: 0, stdout, stderr });
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
