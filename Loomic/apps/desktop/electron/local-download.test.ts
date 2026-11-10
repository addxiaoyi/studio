import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { downloadLocalFile } from "./local-download.js";
const roots: string[] = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
it("streams to disk, verifies the checksum and preserves a prior file", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-download-"))); roots.push(root);
  const bytes = Buffer.alloc(150_000, 7);
  const response = new Response(bytes, { headers: { "content-type": "video/webm", "content-length": String(bytes.length) } });
  const receipt = await downloadLocalFile({ response, directory: root, name: "../video", mediaType: "video", signal: new AbortController().signal });
  expect(receipt.bytes).toBe(bytes.length);
  expect(await readFile(receipt.path)).toEqual(bytes);
  expect(receipt.sha256).toHaveLength(64);
  expect((await readdir(root)).some(name => name.endsWith(".part"))).toBe(false);
});
it("rejects truncated and canceled streams without publishing partial files", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-download-"))); roots.push(root);
  await expect(downloadLocalFile({ response: new Response("abc", { headers: { "content-type": "image/png", "content-length": "100" } }), directory: root, name: "image", mediaType: "image", signal: new AbortController().signal })).rejects.toThrow("完整");
  const controller = new AbortController(); controller.abort();
  await expect(downloadLocalFile({ response: new Response("abc", { headers: { "content-type": "image/png" } }), directory: root, name: "image", mediaType: "image", signal: controller.signal })).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);
});
it("cancels a stream while a read is waiting and removes its temporary file", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-download-"))); roots.push(root);
  const controller = new AbortController();
  const response = new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array([1, 2, 3])); } }), { headers: { "content-type": "video/webm" } });
  const running = downloadLocalFile({ response, directory: root, name: "canceled", mediaType: "video", signal: controller.signal, onProgress: () => controller.abort() });
  await expect(running).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);
});
it("fails on a real HTTP disconnect and never saves an HTML login page as media", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-download-"))); roots.push(root);
  const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "video/mp4", "content-length": "1000" }); res.write("broken"); setTimeout(() => res.destroy(), 10); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    await expect(downloadLocalFile({ response: await fetch(`http://127.0.0.1:${port}`), directory: root, name: "video", mediaType: "video", signal: new AbortController().signal })).rejects.toThrow();
    await expect(downloadLocalFile({ response: new Response("<html>Login</html>", { headers: { "content-type": "text/html" } }), directory: root, name: "video", mediaType: "video", signal: new AbortController().signal })).rejects.toThrow("类型");
    expect(await readdir(root)).toEqual([]);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
