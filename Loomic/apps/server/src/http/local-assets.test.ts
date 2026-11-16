import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerLocalAssetRoutes } from "./local-assets.js";

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createApp(root: string, thumbnailPath: string | null) {
  const app = Fastify();
  apps.push(app);
  const db = {
    query: vi.fn().mockResolvedValue({
      rows: [{ workspace_id: "workspace-1", thumbnail_path: thumbnailPath }],
    }),
  };
  const auth = {
    authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
  };
  registerLocalAssetRoutes(app, { db: db as never, auth: auth as never, root });
  await app.ready();
  return app;
}

describe("local project thumbnail route", () => {
  it("serves a thumbnail from the local project-assets bucket", async () => {
    const root = await mkdtemp(join(tmpdir(), "helstera-project-preview-"));
    const objectPath = "workspace-1/project-1/thumbnail.webp";
    await mkdir(join(root, "project-assets", "workspace-1", "project-1"), { recursive: true });
    await writeFile(join(root, "project-assets", objectPath), Buffer.from([1, 2, 3]));
    const app = await createApp(root, objectPath);

    const response = await app.inject({ method: "GET", url: "/api/projects/project-1/thumbnail" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/webp");
    expect(response.headers["cache-control"]).toBe("private, max-age=3600");
    expect(response.rawPayload).toEqual(Buffer.from([1, 2, 3]));
  });

  it("serves a cloud asset without extending its retention deadline", async () => {
    const root = await mkdtemp(join(tmpdir(), "helstera-asset-download-"));
    const objectPath = "workspace-1/generated/image.png";
    await mkdir(join(root, "project-assets", "workspace-1", "generated"), { recursive: true });
    await writeFile(join(root, "project-assets", objectPath), Buffer.from([7, 8, 9]));
    const dbQuery = vi.fn().mockResolvedValue({ rows: [{ bucket: "project-assets", object_path: objectPath, mime_type: "image/png" }] });
    const app = Fastify();
    apps.push(app);
    registerLocalAssetRoutes(app, {
      db: { query: dbQuery } as never,
      auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) } as never,
      root,
    });
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/api/uploads/object-1/file", headers: { authorization: "Bearer session" } });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(Buffer.from([7, 8, 9]));
    expect(dbQuery).toHaveBeenCalledOnce();
    expect(String(dbQuery.mock.calls[0]?.[0])).not.toContain("update generated_assets");
  });

  it("serves authenticated video byte ranges without bypassing workspace access", async () => {
    const root = await mkdtemp(join(tmpdir(), "helstera-video-range-"));
    const objectPath = "workspace-1/generated/recording.webm";
    await mkdir(join(root, "project-assets", "workspace-1", "generated"), { recursive: true });
    await writeFile(join(root, "project-assets", objectPath), Buffer.from("0123456789"));
    const query = vi.fn().mockResolvedValue({ rows: [{ bucket: "project-assets", object_path: objectPath, mime_type: "video/webm" }] });
    const authenticate = vi.fn().mockResolvedValue({ id: "user-1" });
    const app = Fastify();
    apps.push(app);
    registerLocalAssetRoutes(app, { db: { query } as never, auth: { authenticate } as never, root });
    await app.ready();

    for (const [range, contentRange, expected] of [
      ["bytes=2-5", "bytes 2-5/10", "2345"],
      ["bytes=7-", "bytes 7-9/10", "789"],
      ["bytes=-3", "bytes 7-9/10", "789"],
      ["bytes=8-99", "bytes 8-9/10", "89"],
    ] as const) {
      const response = await app.inject({ method: "GET", url: "/api/uploads/object-1/file", headers: { range } });
      expect(response.statusCode).toBe(206);
      expect(response.headers["content-range"]).toBe(contentRange);
      expect(response.headers["content-length"]).toBe(String(expected.length));
      expect(response.body).toBe(expected);
      expect(response.headers["cache-control"]).toBe("private, max-age=300");
    }
    for (const range of ["bytes=10-", "bytes=-0", "bytes=3-2", "bytes=0-1,4-5", "bytes=999999999999999999999-"]) {
      const response = await app.inject({ method: "GET", url: "/api/uploads/object-1/file", headers: { range } });
      expect(response.statusCode).toBe(416);
      expect(response.headers["content-range"]).toBe("bytes */10");
    }
    const stale = await app.inject({ method: "GET", url: "/api/uploads/object-1/file", headers: { range: "bytes=2-5", "if-range": '"stale"' } });
    expect(stale.statusCode).toBe(200);
    expect(stale.body).toBe("0123456789");
    const original = await app.inject({ url: "/api/uploads/object-1/file" });
    expect(original.headers.etag).toMatch(/^"[a-f0-9]{64}"$/);
    const resumed = await app.inject({ url: "/api/uploads/object-1/file", headers: { range: "bytes=5-", "if-range": original.headers.etag! } });
    expect(resumed.statusCode).toBe(206);
    expect(resumed.body).toBe("56789");
    const originalDownload = await app.inject({ url: "/api/uploads/object-1/file?download=1" });
    expect(originalDownload.statusCode).toBe(200);
    expect(originalDownload.headers["content-disposition"]).toContain("object-1.webm");
    await writeFile(join(root, "project-assets", objectPath), "abcdefghij");
    const replaced = await app.inject({ url: "/api/uploads/object-1/file", headers: { range: "bytes=5-", "if-range": original.headers.etag! } });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.body).toBe("abcdefghij");
    expect(replaced.headers.etag).not.toBe(original.headers.etag);

    authenticate.mockResolvedValueOnce(null);
    const unauthenticated = await app.inject({ method: "GET", url: "/api/uploads/object-1/file", headers: { range: "bytes=0-1" } });
    expect(unauthenticated.statusCode).toBe(401);
    query.mockResolvedValueOnce({ rows: [] });
    const forbidden = await app.inject({ method: "GET", url: "/api/uploads/object-1/file", headers: { range: "bytes=0-1" } });
    expect(forbidden.statusCode).toBe(404);
  });

  it.each(["project-assets", "private-try-on"])("keeps %s previews separate from downloads and preserves cache policy on revalidation", async (bucket) => {
    const root = await mkdtemp(join(tmpdir(), "helstera-media-preview-"));
    const objectPath = "workspace-1/generated/image.png";
    const original = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 20, g: 40, b: 60 } },
    }).png().toBuffer();
    await mkdir(join(root, bucket, "workspace-1", "generated"), { recursive: true });
    await writeFile(join(root, bucket, objectPath), original);
    const query = vi.fn().mockResolvedValue({ rows: [{ bucket, object_path: objectPath, mime_type: "image/png" }] });
    const app = Fastify();
    apps.push(app);
    registerLocalAssetRoutes(app, { db: { query } as never, auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) } as never, root });
    await app.ready();

    const preview = await app.inject({ method: "GET", url: "/api/uploads/object-1/file?preview=1" });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toContain("image/webp");
    expect(preview.headers["x-media-preview"]).toBe("generated");
    expect(preview.headers.etag).toMatch(/^W\/\"preview-[a-f0-9]+\"$/);
    expect(preview.rawPayload).not.toEqual(original);
    const previewEtag = preview.headers.etag;
    if (!previewEtag) throw new Error("Preview response did not include an ETag.");

    const revalidated = await app.inject({
      method: "GET",
      url: "/api/uploads/object-1/file?preview=1",
      headers: { "if-none-match": previewEtag },
    });
    expect(revalidated.statusCode).toBe(304);
    expect(revalidated.headers["cache-control"]).toBe(bucket === "private-try-on" ? "private, no-store" : "private, max-age=86400");
    expect(revalidated.headers.vary).toBe("Authorization, Cookie");

    const download = await app.inject({ method: "GET", url: "/api/uploads/object-1/file?download=1" });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("image/png");
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.rawPayload).toEqual(original);
  });

  it("does not serve an unregistered legacy thumbnail", async () => {
    const root = await mkdtemp(join(tmpdir(), "helstera-project-preview-"));
    await mkdir(join(root, "workspace-1", "project-1"), { recursive: true });
    await writeFile(join(root, "workspace-1", "project-1", "thumbnail.png"), Buffer.from([4, 5, 6]));
    const app = await createApp(root, null);

    const response = await app.inject({ method: "GET", url: "/api/projects/project-1/thumbnail" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "thumbnail_not_found" } });
  });
});
