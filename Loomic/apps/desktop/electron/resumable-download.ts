import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, realpath, rename, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileSha256, type LocalReceipt } from "./local-download.js";
import { writeJsonAtomic } from "./desktop-setup.js";

const MAX_BYTES = 2 * 1024 ** 3;
const RESERVE = 64 * 1024 ** 2;
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg" };
type Checkpoint = { version: 1; id: string; bytes: number; total: number | null; validator: string; mime: string; sha256: string; filename: string };
export type DownloadProgress = { bytes: number; totalBytes: number | null; bytesPerSecond: number; remainingSeconds: number | null; resumedBytes: number };
type DownloadInput = { directory: string; key: string; name: string; mediaType: "image" | "video" | "audio"; signal: AbortSignal; request: (headers: Record<string, string>) => Promise<Response>; onProgress?: (progress: DownloadProgress) => void };

function validator(response: Response): string {
  const etag = response.headers.get("etag");
  if (etag && !etag.startsWith("W/")) return etag;
  return response.headers.get("last-modified") ?? "";
}
async function removeCheckpoint(...paths: string[]) {
  for (const path of paths) await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; });
}
async function readCheckpoint(path: string, part: string): Promise<Checkpoint | null> {
  try {
    if (await realpath(path) !== path) throw new Error("Unsafe download checkpoint");
    const value = JSON.parse(await readFile(path, "utf8")) as Checkpoint;
    if (value.version !== 1 || !/^[a-f\d-]{36}$/.test(value.id) || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > MAX_BYTES
      || !/^[a-f\d]{64}$/.test(value.sha256) || !value.validator || !EXTENSIONS[value.mime] || !/^[^/\\:]+$/.test(value.filename)
      || !value.filename.endsWith(`-${value.id.slice(0, 8)}.${EXTENSIONS[value.mime]}`)) throw new Error("Invalid download checkpoint");
    if (await realpath(part) !== part) throw new Error("Unsafe partial file");
    const info = await stat(part);
    if (!info.isFile() || info.size !== value.bytes || await fileSha256(part) !== value.sha256) throw new Error("Partial file changed");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[local-download] Invalid checkpoint; restarting the file.");
    await removeCheckpoint(path, part); return null;
  }
}

export async function resumeDownload(input: DownloadInput): Promise<LocalReceipt> {
  input.signal.throwIfAborted();
  const root = await realpath(input.directory);
  if (root !== input.directory) throw new Error("保存目录已改变，请重新选择工作区。");
  const cache = join(root, ".helstera-downloads");
  await mkdir(cache, { recursive: true });
  if (await realpath(cache) !== cache) throw new Error("续传目录不可为链接。");
  const key = createHash("sha256").update(input.key).digest("hex");
  const metadata = join(cache, `${key}.json`), part = join(cache, `${key}.part`);
  let prior = await readCheckpoint(metadata, part);
  let response = await input.request(prior ? { Range: `bytes=${prior.bytes}-`, "If-Range": prior.validator } : {});
  if (response.status === 416 && prior) {
    await response.body?.cancel(); await removeCheckpoint(metadata, part); prior = null;
    response = await input.request({});
  }
  if (!response.ok || !response.body) throw new Error(`下载失败（${response.status}），已保存片段保留，可重试。`);
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!EXTENSIONS[mime] || !mime.startsWith(`${input.mediaType}/`)) { await response.body.cancel(); throw new Error("下载文件类型不符。"); }
  const currentValidator = validator(response);
  let total: number | null = response.headers.has("content-length") ? Number(response.headers.get("content-length")) : null;
  if (response.status === 206) {
    const range = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!prior || !range || Number(range[1]) !== prior.bytes || currentValidator !== prior.validator || mime !== prior.mime
      || Number(range[2]) < prior.bytes || Number(range[2]) + 1 !== Number(range[3]) || (prior.total !== null && Number(range[3]) !== prior.total)
      || (total !== null && total !== Number(range[2]) - Number(range[1]) + 1)) {
      await response.body.cancel(); await removeCheckpoint(metadata, part); throw new Error("续传响应不匹配，请重试完整下载。");
    }
    total = Number(range[3]);
  } else {
    if (prior) await removeCheckpoint(metadata, part);
    prior = null;
  }
  if (total !== null && (!Number.isSafeInteger(total) || total <= 0 || total > MAX_BYTES)) { await response.body.cancel(); throw new Error("文件大小无效或超过 2 GiB。"); }
  const space = await statfs(root);
  if (space.bavail * space.bsize < (total ?? 0) - (prior?.bytes ?? 0) + RESERVE) { await response.body.cancel(); throw new Error("本地磁盘空间不足，请释放空间后继续。"); }
  const id = prior?.id ?? randomUUID();
  const name = input.name.normalize("NFKC").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/^[. ]+|[. ]+$/g, "").slice(0, 80) || "helstera";
  const filename = prior?.filename ?? `${name}-${id.slice(0, 8)}.${EXTENSIONS[mime]}`;
  const file = await open(part, prior ? "a" : "wx");
  const hash = createHash("sha256");
  if (prior) for await (const chunk of createReadStream(part)) hash.update(chunk);
  const resumedBytes = prior?.bytes ?? 0;
  let bytes = resumedBytes, checkpointBytes = resumedBytes, closed = false, completed = false;
  const started = performance.now();
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  input.signal.addEventListener("abort", cancel, { once: true });
  const progress = () => {
    const bytesPerSecond = Math.round((bytes - resumedBytes) / Math.max((performance.now() - started) / 1000, 0.05));
    input.onProgress?.({ bytes, totalBytes: total, resumedBytes, bytesPerSecond,
      remainingSeconds: total !== null && bytesPerSecond > 0 ? Math.max(0, Math.ceil((total - bytes) / bytesPerSecond)) : null });
  };
  const checkpoint = async () => {
    if (!currentValidator || bytes === 0) return;
    await file.sync();
    await writeJsonAtomic(metadata, { version: 1, id, bytes, total, validator: currentValidator, mime, filename, sha256: hash.copy().digest("hex") } satisfies Checkpoint);
    checkpointBytes = bytes;
  };
  try {
    progress();
    while (true) {
      input.signal.throwIfAborted();
      let idle: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => {
        idle = setTimeout(() => { cancel(); reject(new Error("下载连接超时，已保留片段，可继续下载。")); }, 30_000);
      })]).finally(() => { if (idle) clearTimeout(idle); });
      input.signal.throwIfAborted();
      if (next.done) break;
      if (bytes + next.value.length > MAX_BYTES || (total !== null && bytes + next.value.length > total)) throw new Error("下载长度异常。");
      await file.writeFile(next.value); bytes += next.value.length; hash.update(next.value);
      progress();
      if (bytes - checkpointBytes >= 1024 * 1024) await checkpoint();
    }
    if (!bytes || total !== null && bytes !== total) throw new Error("下载不完整，重试将继续已保存的片段。");
    await checkpoint(); await file.sync(); await file.close(); closed = true;
    const sha256 = hash.digest("hex");
    if (await fileSha256(part) !== sha256) { await removeCheckpoint(metadata, part); throw new Error("本地文件校验失败。"); }
    input.signal.throwIfAborted();
    const path = join(root, filename);
    await rename(part, path); completed = true; await removeCheckpoint(metadata);
    progress(); return { path, bytes, sha256, savedAt: new Date().toISOString() };
  } finally {
    input.signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    if (!closed) { try { await checkpoint(); } finally { await file.close(); } }
    if (!completed && !currentValidator) await removeCheckpoint(metadata, part);
  }
}
