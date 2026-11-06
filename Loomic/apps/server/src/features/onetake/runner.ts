import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stopMediaProcess } from "./process-tree.js";

const MAX_OUTPUT = 16 * 1024 * 1024;
const script = fileURLToPath(new URL("./runner.py", import.meta.url));
const SUPPORTED_MODELS = ["tiny", "base", "small", "medium", "large-v3"];
export function oneTakeModels(): string[] {
  const models = process.env.HELSTERA_ONETAKE_MODELS?.split(",").map(model => model.trim()).filter(Boolean) ?? SUPPORTED_MODELS;
  if (!models.length || models.some(model => !SUPPORTED_MODELS.includes(model))) throw new Error("HELSTERA_ONETAKE_MODELS contains an unsupported speech model.");
  return [...new Set(models)];
}

export async function runOneTake(input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const python = process.env.HELSTERA_ONETAKE_PYTHON;
  if (!python) throw new Error("未配置 OneTake 转写运行环境，请联系管理员。");
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-u", script], { windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    const chunks: Buffer[] = [];
    let size = 0;
    let diagnostic = "";
    let stopping: Promise<void> | undefined;
    let failure: Error | undefined;
    const stop = (reason: Error) => {
      failure ??= reason;
      stopping ??= stopMediaProcess(child).catch(error => { console.error("[onetake] process tree termination failed", error); reject(error); });
    };
    const abort = () => stop(new Error("OneTake operation canceled", { cause: signal?.reason }));
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => stop(new Error("OneTake operation timed out")), input.operation === "probe" ? 30_000 : 30 * 60_000);
    const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); };
    child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_OUTPUT) stop(new Error("OneTake response exceeds output limit")); else chunks.push(chunk); });
    child.stderr.on("data", chunk => { diagnostic = (diagnostic + String(chunk)).slice(-3000); });
    child.once("error", error => { cleanup(); reject(error); });
    child.once("close", async code => {
      cleanup();
      await stopping;
      if (failure) { reject(failure); return; }
      if (code !== 0 || size > MAX_OUTPUT) { reject(new Error(`OneTake ${String(input.operation)} failed (exit ${code}): ${diagnostic || "No process diagnostic"}`)); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (error) { reject(new Error("OneTake returned an invalid response", { cause: error })); }
    });
    child.stdin.on("error", error => stop(error));
    child.stdin.end(JSON.stringify(input));
  });
}

export async function probeOneTake() {
  if (!process.env.HELSTERA_ONETAKE_PYTHON) return { available: false, burnSubtitles: false, reason: "尚未配置转写运行环境。" };
  try {
    const probe = await runOneTake({ operation: "probe" }) as { available?: boolean; burnSubtitles?: boolean };
    return { available: probe.available === true, burnSubtitles: probe.burnSubtitles === true, reason: "" };
  } catch (error) {
    console.error("[onetake] runtime check failed", error);
    return { available: false, burnSubtitles: false, reason: "转写引擎或 FFmpeg 不可用，请检查服务端运行环境。" };
  }
}
