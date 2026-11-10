import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { Readable } from "node:stream";

type Grant = { root: string; path: string; mime: string; fingerprint: string; expires: number };
const fingerprint = (file: Stats) => `${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`;
const ALLOWED_MIME = /^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|wav|ogg))$/;

function byteRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || !match[1] && !match[2]) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : null;
}

export class LocalMedia {
  private grants = new Map<string, Grant>();
  constructor(private readonly currentRoot: () => Promise<string | null>) {}
  revoke() { this.grants.clear(); }
  async grant(root: string, path: string, mime: string) {
    const within = relative(root, path);
    if (!ALLOWED_MIME.test(mime) || !within || within.startsWith("..") || isAbsolute(within) || await realpath(path) !== path) throw new Error("本地预览文件无效。");
    const info = await stat(path);
    if (!info.isFile() || !info.size) throw new Error("本地素材为空或不可读取。");
    const id = randomUUID();
    this.grants.set(id, { root, path, mime, fingerprint: fingerprint(info), expires: Date.now() + 30 * 60_000 });
    if (this.grants.size > 128) this.grants.delete(this.grants.keys().next().value!);
    return `helstera-media://local/${id}`;
  }
  async respond(request: Request): Promise<Response> {
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
    const url = new URL(request.url), grant = url.hostname === "local" ? this.grants.get(url.pathname.slice(1)) : undefined;
    if (!grant) return new Response(null, { status: 404 });
    if (grant.expires <= Date.now() || await this.currentRoot() !== grant.root) return new Response(null, { status: 410 });
    try {
      if (await realpath(grant.path) !== grant.path) return new Response(null, { status: 410 });
      const file = await open(grant.path, "r");
      let streaming = false;
      try {
        const info = await file.stat();
        if (fingerprint(info) !== grant.fingerprint) return new Response(null, { status: 410 });
        const rangeHeader = request.headers.get("range"), range = rangeHeader ? byteRange(rangeHeader, info.size) : null;
        if (rangeHeader && !range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
        const headers: Record<string, string> = { "Content-Type": grant.mime, "Cache-Control": "no-store", "Accept-Ranges": "bytes", "Content-Length": String(range ? range.end - range.start + 1 : info.size), "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*" };
        if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
        if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
        const stream = file.createReadStream({ ...range, autoClose: true });
        streaming = true;
        return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
      } finally { if (!streaming) await file.close(); }
    } catch (error) {
      if (["ENOENT", "EACCES", "EPERM"].includes(String((error as NodeJS.ErrnoException).code))) return new Response(null, { status: 410 });
      console.error("[local-media] Preview stream failed", error);
      return new Response(null, { status: 500 });
    }
  }
}
