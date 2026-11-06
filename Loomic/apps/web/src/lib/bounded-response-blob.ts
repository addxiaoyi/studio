export async function boundedResponseBlob(response: Response, limit: number): Promise<Blob> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) throw new Error(`视频不能超过 ${Math.floor(limit / (1024 * 1024))} MB。`);
  if (!response.body) throw new Error("无法读取视频内容。");

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel("Video exceeds size limit");
        throw new Error(`视频不能超过 ${Math.floor(limit / (1024 * 1024))} MB。`);
      }
      chunks.push(value.slice().buffer as ArrayBuffer);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
}
