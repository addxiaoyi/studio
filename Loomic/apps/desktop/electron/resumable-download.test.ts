import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { resumeDownload } from "./resumable-download.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it("resumes a real interrupted HTTP transfer after restart and verifies the final bytes", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-resume-"))); roots.push(root);
  const bytes = Buffer.alloc(1024 * 256, 7), ranges: string[] = []; let first = true;
  const server = createServer((req, res) => {
    const offset = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0); ranges.push(req.headers.range ?? "full");
    if (offset) expect(req.headers["if-range"]).toBe('"v1"');
    res.writeHead(offset ? 206 : 200, { "content-type": "video/webm", "content-length": bytes.length - offset, etag: '"v1"', ...(offset ? { "content-range": `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {}) });
    if (first) { first = false; res.write(bytes.subarray(0, 65536)); setTimeout(() => res.destroy(), 30); }
    else res.end(bytes.subarray(offset));
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const options = { directory: root, key: "account:video", name: "录像", mediaType: "video" as const, signal: new AbortController().signal, request: (headers: Record<string, string>) => fetch(url, { headers }) };
    await expect(resumeDownload(options)).rejects.toThrow();
    expect((await readdir(root)).filter(name => !name.startsWith("."))).toEqual([]);
    const receipt = await resumeDownload(options);
    expect(ranges).toEqual(["full", "bytes=65536-"]);
    expect(await readFile(receipt.path)).toEqual(bytes);
    expect(receipt.sha256).toHaveLength(64);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
it("starts over if If-Range returns a new version and exposes speed and ETA", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-resume-"))); roots.push(root);
  let calls = 0; const progress: Array<{ bytesPerSecond: number; remainingSeconds: number | null }> = [];
  const options = { directory: root, key: "changed", name: "片段", mediaType: "video" as const, signal: new AbortController().signal,
    onProgress: (value: { bytesPerSecond: number; remainingSeconds: number | null }) => progress.push(value),
    request: async (headers: Record<string, string>) => {
      calls++;
      if (calls === 1) return new Response(new ReadableStream({ async start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); await new Promise(done => setTimeout(done, 10)); controller.error(new Error("disconnect")); } }), { headers: { "content-type": "video/mp4", etag: '"old"', "content-length": "6" } });
      expect(headers.Range).toBe("bytes=3-");
      return new Response(new Uint8Array([4, 5, 6, 7]), { headers: { "content-type": "video/mp4", etag: '"new"', "content-length": "4" } });
    } };
  await expect(resumeDownload(options)).rejects.toThrow();
  const receipt = await resumeDownload(options);
  expect([...await readFile(receipt.path)]).toEqual([4, 5, 6, 7]);
  expect(progress.some(value => value.bytesPerSecond > 0)).toBe(true);
  expect(progress.at(-1)?.remainingSeconds).toBe(0);
});
it("keeps canceled bytes for retry and rejects a mismatched range without a final file", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-resume-"))); roots.push(root);
  const controller = new AbortController();
  await expect(resumeDownload({ directory: root, key: "cancel", name: "v", mediaType: "video", signal: controller.signal,
    request: async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array([1, 2, 3])); } }), { headers: { "content-type": "video/webm", etag: '"v1"', "content-length": "10" } }),
    onProgress: value => { if (value.bytes) controller.abort(); },
  })).rejects.toThrow();
  await expect(resumeDownload({ directory: root, key: "cancel", name: "v", mediaType: "video", signal: new AbortController().signal,
    request: async () => new Response(new Uint8Array([4]), { status: 206, headers: { "content-type": "video/webm", etag: '"v1"', "content-range": "bytes 8-8/10", "content-length": "1" } }),
  })).rejects.toThrow("续传");
  expect((await readdir(root)).filter(name => !name.startsWith("."))).toEqual([]);
});
