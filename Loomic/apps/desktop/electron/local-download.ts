import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, realpath, rename, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";

const MAX_FILE_BYTES = 2 * 1024 ** 3;
const DISK_RESERVE_BYTES = 64 * 1024 ** 2;
const MIME_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "application/json": "json" };
export type LocalReceipt = { path: string; bytes: number; sha256: string; savedAt: string };

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function receiptExists(receipt: LocalReceipt): Promise<boolean> {
  try { return (await stat(receipt.path)).size === receipt.bytes && await fileSha256(receipt.path) === receipt.sha256; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export async function downloadLocalFile(input: {
  response: Response; directory: string; name: string; mediaType: "image" | "video" | "audio" | "json";
  signal: AbortSignal; onProgress?: (bytes: number, total: number | null) => void;
}): Promise<LocalReceipt> {
  const { response, signal } = input;
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const extension = MIME_EXTENSIONS[mime];
  if (!response.ok || !response.body) throw new Error(`下载失败（${response.status}），请登录后重试。`);
  if (!extension || (input.mediaType === "json" ? mime !== "application/json" : !mime.startsWith(`${input.mediaType}/`))) throw new Error("下载文件类型不符，未保存文件。");
  const rawLength = response.headers.get("content-length");
  const total = rawLength === null ? null : Number(rawLength);
  if (total !== null && (!Number.isSafeInteger(total) || total <= 0 || total > MAX_FILE_BYTES)) throw new Error("文件大小无效或超过 2 GiB，请使用原文件下载。");
  signal.throwIfAborted();
  await mkdir(input.directory, { recursive: true });
  const directory = await realpath(input.directory);
  if (directory !== input.directory) throw new Error("保存目录已改变，请重新选择工作区。");
  const space = await statfs(directory);
  if (space.bavail * space.bsize < (total ?? 0) + DISK_RESERVE_BYTES) throw new Error("本地磁盘空间不足，请清理空间或选择其他工作区。");
  const id = randomUUID();
  const safeName = input.name.normalize("NFKC").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/^[. ]+|[. ]+$/g, "").slice(0, 80) || "helstera";
  const path = join(directory, `${safeName}-${id.slice(0, 8)}.${extension}`);
  const part = join(directory, `.${id}.part`);
  const file = await open(part, "wx");
  let closed = false;
  let published = false;
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  let bytes = 0;
  const hash = createHash("sha256");
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_FILE_BYTES || (total !== null && bytes > total)) throw new Error("下载长度异常，未发布文件。");
      await file.writeFile(chunk.value);
      hash.update(chunk.value);
      input.onProgress?.(bytes, total);
    }
    if (bytes === 0 || (total !== null && bytes !== total)) throw new Error("文件下载不完整，请重试。");
    await file.sync(); await file.close(); closed = true;
    const sha256 = hash.digest("hex");
    if (await fileSha256(part) !== sha256) throw new Error("本地文件校验失败，请检查磁盘后重试。");
    signal.throwIfAborted();
    await rename(part, path); published = true;
    return { path, bytes, sha256, savedAt: new Date().toISOString() };
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    if (!closed) await file.close();
    if (!published) await unlink(part);
  }
}
