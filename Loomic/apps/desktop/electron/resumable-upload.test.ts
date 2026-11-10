import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { uploadVideoInChunks } from "./resumable-upload.js";
it("resumes from server-acknowledged bytes after a lost response and preserves checksums", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-upload-")));
  try {
    const path = join(root, "video.mp4"), bytes = Buffer.alloc(1024 * 32, 7); await writeFile(path, bytes);
    let offset = 0, lost = true, commits = 0; const ranges: number[] = [], progress: number[] = [];
    const assetId = randomUUID();
    const options = { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: "video/mp4" as const, filename: "video.mp4", uploadId: randomUUID(), signal: new AbortController().signal,
      request: async (_url: string, options: RequestInit) => {
        if (options.method === "PATCH") {
          const headers = options.headers as Record<string, string>, chunk = Buffer.from(options.body as Uint8Array);
          expect(headers["upload-checksum"]).toBe(createHash("sha256").update(chunk).digest("hex"));
          expect(Number(headers["upload-offset"])).toBe(offset); ranges.push(offset); offset += chunk.length;
          if (lost) { lost = false; throw new Error("connection lost"); }
        }
        if (options.method === "POST") commits++;
        return Response.json({ ok: true, data: { offset, bytes: bytes.length, chunkBytes: 8192, assetId: commits ? assetId : null } });
      }, onProgress: (value: { resumedBytes: number }) => progress.push(value.resumedBytes) };
    await expect(uploadVideoInChunks(options)).rejects.toThrow("connection lost");
    expect(await uploadVideoInChunks(options)).toBe(assetId);
    expect(ranges).toEqual([0, 8192, 16384, 24576]); expect(progress).toContain(8192); expect(commits).toBe(1);
  } finally { await rm(root, { recursive: true }); }
});
