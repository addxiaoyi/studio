import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
export type UploadProgress = { bytes: number; totalBytes: number; resumedBytes: number; bytesPerSecond: number; remainingSeconds: number | null };
type UploadStatus = { offset: number; bytes: number; chunkBytes: number; assetId: string | null };
type UploadOptions = { path: string; bytes: number; sha256: string; mimeType: "video/mp4" | "video/webm"; filename: string; uploadId: string; signal: AbortSignal; request: (path: string, options: RequestInit) => Promise<Response>; onProgress?: (progress: UploadProgress) => void };
const MAX_CHUNK = 8 * 1024 ** 2;

export async function uploadVideoInChunks(input: UploadOptions): Promise<string> {
  const path = `/api/assets/private-video/uploads/${input.uploadId}`;
  const send = async (options: RequestInit) => {
    input.signal.throwIfAborted();
    const response = await input.request(path, { ...options, signal: input.signal });
    const body = await response.json() as { ok?: boolean; data?: UploadStatus; error?: { message?: string } };
    if (!response.ok || !body.ok || !body.data) throw new Error(body.error?.message ?? `视频上传失败（${response.status}），可继续上传。`);
    const state = body.data;
    if (state.bytes !== input.bytes || !Number.isSafeInteger(state.offset) || state.offset < 0 || state.offset > input.bytes || !Number.isInteger(state.chunkBytes) || state.chunkBytes < 1 || state.chunkBytes > MAX_CHUNK || state.assetId && !/^[a-f0-9-]{36}$/i.test(state.assetId)) throw new Error("云端上传进度无效，请重试。");
    return state;
  };
  const state = await send({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ bytes: input.bytes, sha256: input.sha256, mimeType: input.mimeType, filename: input.filename }) });
  if (state.assetId) return state.assetId;
  const resumedBytes = state.offset, started = performance.now();
  let offset = state.offset;
  const progress = () => {
    const bytesPerSecond = Math.round((offset - resumedBytes) / Math.max(0.05, (performance.now() - started) / 1000));
    input.onProgress?.({ bytes: offset, totalBytes: input.bytes, resumedBytes, bytesPerSecond, remainingSeconds: bytesPerSecond > 0 ? Math.ceil((input.bytes - offset) / bytesPerSecond) : null });
  };
  const file = await open(input.path, "r");
  try {
    progress();
    while (offset < input.bytes) {
      input.signal.throwIfAborted();
      const chunk = Buffer.alloc(Math.min(state.chunkBytes, input.bytes - offset));
      let read = 0;
      while (read < chunk.length) { const part = await file.read(chunk, read, chunk.length - read, offset + read); if (!part.bytesRead) throw new Error("本地视频已改变，请重新预览。"); read += part.bytesRead; }
      const checksum = createHash("sha256").update(chunk).digest("hex");
      const saved = await send({ method: "PATCH", headers: { "content-type": "application/octet-stream", "upload-offset": String(offset), "upload-checksum": checksum }, body: new Uint8Array(chunk) });
      if (saved.offset !== offset + chunk.length) throw new Error("云端上传偏移已改变，重试会重新读取进度。");
      offset = saved.offset; progress();
    }
    const completed = await send({ method: "POST" });
    if (!completed.assetId) throw new Error("素材保存回执缺失，请重试完成上传。");
    return completed.assetId;
  } finally { await file.close(); }
}
