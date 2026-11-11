import Fastify from "fastify";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePublicManifest } from "../storage/public-media.js";
import { registerPublicMediaRoutes, type PublicMediaStore } from "./public-media.js";

const hash = "a".repeat(64);
const path = "fashion-gallery/img/SPR-0001.webp";
const entry = { key: `loomic-public/${hash}/SPR-0001.webp`, sha256: hash, bytes: 4, mime: "image/webp" as const };
const apps: ReturnType<typeof Fastify>[] = [];
function setup() {
  const app = Fastify(); apps.push(app);
  const read = vi.fn<PublicMediaStore["read"]>(async () => ({ Body: Readable.from(Buffer.from("webp")) as never, ContentLength: 4, $metadata: {} }));
  registerPublicMediaRoutes(app, { manifest: parsePublicManifest({ [path]: entry }), read, close: vi.fn() });
  return { app, read };
}
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe("public Qiniu media boundary", () => {
  it("streams only a verified public manifest entry", async () => {
    const { app, read } = setup();
    const response = await app.inject(`/api/public-media/${path}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("webp");
    expect(response.headers["x-media-storage"]).toBe("qiniu");
    expect(response.headers["content-type"]).toBe("image/webp");
    expect(read.mock.calls[0]?.[0]).toBe(entry.key);
  });
  it.each(["private-video/user/file.mp4", "private-try-on/photo.webp", "fashion-gallery/img/MISSING.webp", "database.dump"])("never reads an unpublished key: %s", async (key) => {
    const { app, read } = setup();
    expect((await app.inject(`/api/public-media/${key}`)).statusCode).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects private paths and mismatched hashes in the manifest", () => {
    expect(() => parsePublicManifest({ "private-video/user.mp4": entry })).toThrow();
    expect(() => parsePublicManifest({ [path]: { ...entry, sha256: "b".repeat(64) } })).toThrow();
  });
  it("serves conditional requests without an upstream call", async () => {
    const { app, read } = setup();
    expect((await app.inject({ url: `/api/public-media/${path}`, headers: { "if-none-match": `"${hash}"` } })).statusCode).toBe(304);
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects multipart ranges and forwards a single range", async () => {
    const { app, read } = setup();
    expect((await app.inject({ url: `/api/public-media/${path}`, headers: { range: "bytes=0-1,2-3" } })).statusCode).toBe(416);
    expect(read).not.toHaveBeenCalled();
    read.mockResolvedValueOnce({ Body: Readable.from(Buffer.from("we")) as never, ContentLength: 2, ContentRange: "bytes 0-1/4", $metadata: {} });
    const response = await app.inject({ url: `/api/public-media/${path}`, headers: { range: "bytes=0-1" } });
    expect(response.statusCode).toBe(206);
    expect(response.body).toBe("we");
    expect(read.mock.calls[0]?.[1]).toBe("bytes=0-1");
  });
  it("reports upstream failure without exposing signed details", async () => {
    const { app, read } = setup();
    read.mockRejectedValueOnce(new Error("secret signed request"));
    const response = await app.inject(`/api/public-media/${path}`);
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain("secret");
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
