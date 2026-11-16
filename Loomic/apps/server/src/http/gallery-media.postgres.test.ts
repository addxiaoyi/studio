import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerGalleryMediaRoutes } from "./gallery-media.js";
import { registerLocalAssetRoutes } from "./local-assets.js";
import { registerLocalGrowthRoutes } from "./local-growth.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)(
  "published gallery media",
  () => {
    const schema = `gallery_media_${randomUUID().replaceAll("-", "")}`;
    const owner = randomUUID();
    const peer = randomUUID();
    const workspace = randomUUID();
    const otherWorkspace = randomUUID();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9kAAAAASUVORK5CYII=",
      "base64",
    );
    const app = Fastify();
    let admin: Pool;
    let db: Pool;
    let root: string;
    let folder: string;
    let asset: string;
    let object: string;
    let gallery: string;
    let objectPath: string;

    beforeAll(async () => {
      const url = new URL(process.env.HELT_TEST_DATABASE_URL ?? "");
      if (url.hostname !== "127.0.0.1")
        throw new Error("Gallery media tests require loopback PostgreSQL");
      admin = new Pool({ connectionString: url.href });
      await admin.query(`create schema ${schema}`);
      db = new Pool({
        connectionString: url.href,
        options: `-c search_path=${schema},public`,
      });
      await db.query(
        await readFile(
          new URL("../local-db/schema.sql", import.meta.url),
          "utf8",
        ),
      );
      await db.query(
        "insert into app_users(id,email) values($1,'owner@gallerymedia.test'),($2,'peer@gallerymedia.test')",
        [owner, peer],
      );
      await db.query(
        "insert into workspaces(id,owner_user_id,name) values($1,$2,'Owner'),($3,$4,'Peer')",
        [workspace, owner, otherWorkspace, peer],
      );
      await db.query(
        "insert into workspace_members(workspace_id,user_id) values($1,$2),($3,$4)",
        [workspace, owner, otherWorkspace, peer],
      );
      folder = await mkdtemp(join(tmpdir(), "helstera-gallery-media-"));
      root = join(folder, "storage");
      await mkdir(join(root, "private-try-on", workspace), { recursive: true });
      const auth = {
        authenticate: async (request: {
          headers: { authorization?: string };
        }) => {
          const id = request.headers.authorization;
          return id === owner || id === peer
            ? {
                id,
                accessToken: id,
                email: "gallery@test.invalid",
                userMetadata: {},
              }
            : null;
        },
      };
      registerLocalGrowthRoutes(app, {
        db,
        auth,
        viewerService: {
          ensureViewer: async (user) =>
            ({
              workspace: { id: user.id === owner ? workspace : otherWorkspace },
              profile: { id: user.id },
            }) as never,
        },
      });
      registerLocalAssetRoutes(app, { db, auth, root });
      registerGalleryMediaRoutes(app, { db, root });
      await app.ready();
    });
    beforeEach(async () => {
      await db.query(
        "truncate generated_assets cascade; truncate asset_objects cascade",
      );
      asset = randomUUID();
      object = randomUUID();
      gallery = randomUUID();
      objectPath = `${workspace}/${object}.png`;
      await writeFile(join(root, "private-try-on", objectPath), png);
      await db.query(
        "insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type,byte_size) values($1,$2,$3,'private-try-on',$4,'image/png',$5)",
        [object, workspace, owner, objectPath, png.length],
      );
      await db.query(
        "insert into generated_assets(id,workspace_id,created_by,media_type,object_path,mime_type,title) values($1,$2,$3,'image',$4,'image/png','Gallery media')",
        [asset, workspace, owner, objectPath],
      );
      await db.query(
        "insert into gallery_items(id,asset_id,workspace_id,owner_id,status,published_at) values($1,$2,$3,$4,'published',now())",
        [gallery, asset, workspace, owner],
      );
    });
    afterAll(async () => {
      await app.close();
      await db?.end();
      if (admin) {
        try {
          await admin.query(`drop schema if exists ${schema} cascade`);
        } finally {
          await admin.end();
        }
      }
      if (folder) await rm(folder, { recursive: true, force: true });
    });

    it("streams the explicitly published owner's media to anonymous and other workspace readers without opening private uploads", async () => {
      const feed = await app.inject("/api/gallery");
      const path = `/api/gallery/${gallery}/media`;
      expect(feed.json().data[0].object_url).toBe(path);
      for (const headers of [{}, { authorization: peer }]) {
        const response = await app.inject({ url: path, headers });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.rawPayload).toEqual(png);
        expect(response.headers["content-type"]).toBe("image/png");
        expect(response.headers["cache-control"]).toContain("no-store");
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
      }
      expect((await app.inject(`/api/uploads/${object}/file`)).statusCode).toBe(
        401,
      );
      expect(
        (
          await app.inject({
            url: `/api/uploads/${object}/file`,
            headers: { authorization: peer },
          })
        ).statusCode,
      ).toBe(404);
    });

    it.each(["hidden", "deleted", "expired", "purged", "orphaned-owner"])(
      "revokes every new GET, HEAD and conditional request when %s",
      async (state) => {
        const url = `/api/gallery/${gallery}/media`;
        const before = await app.inject(url);
        expect(before.statusCode).toBe(200);
        const etag = String(before.headers.etag);
        if (state === "hidden")
          await db.query(
            "update gallery_items set status='hidden',deleted_at=now() where id=$1",
            [gallery],
          );
        if (state === "deleted")
          await db.query(
            "update generated_assets set deleted_at=now(),retention_state='soft_deleted' where id=$1",
            [asset],
          );
        if (state === "expired")
          await db.query(
            "update generated_assets set retention_until=now()-interval '1 second' where id=$1",
            [asset],
          );
        if (state === "purged")
          await db.query(
            "update generated_assets set retention_state='purged' where id=$1",
            [asset],
          );
        if (state === "orphaned-owner")
          await db.query(
            "delete from workspace_members where workspace_id=$1 and user_id=$2",
            [workspace, owner],
          );
        try {
          for (const method of ["GET", "HEAD"] as const) {
            const response = await app.inject({
              method,
              url,
              headers: {
                range: "bytes=0-5",
                "if-range": etag,
                "if-none-match": etag,
              },
            });
            expect(response.statusCode).toBe(404);
            expect(response.headers["cache-control"]).toContain("no-store");
            expect(response.rawPayload.equals(png)).toBe(false);
          }
        } finally {
          if (state === "orphaned-owner")
            await db.query(
              "insert into workspace_members(workspace_id,user_id) values($1,$2)",
              [workspace, owner],
            );
        }
      },
    );

    it("serves correct HEAD and byte ranges and sends a full representation when If-Range is stale", async () => {
      const url = `/api/gallery/${gallery}/media`;
      const head = await app.inject({ method: "HEAD", url });
      expect(head.statusCode).toBe(200);
      expect(head.body).toBe("");
      expect(Number(head.headers["content-length"])).toBe(png.length);
      const etag = String(head.headers.etag);
      const selected = await app.inject({
        url,
        headers: { range: "bytes=2-7", "if-range": etag },
      });
      expect(selected.statusCode).toBe(206);
      expect(selected.rawPayload).toEqual(png.subarray(2, 8));
      expect(selected.headers["content-range"]).toBe(`bytes 2-7/${png.length}`);
      const suffix = await app.inject({ url, headers: { range: "bytes=-4" } });
      expect(suffix.statusCode).toBe(206);
      expect(suffix.rawPayload).toEqual(png.subarray(-4));
      const stale = await app.inject({
        url,
        headers: { range: "bytes=2-7", "if-range": '"old"' },
      });
      expect(stale.statusCode).toBe(200);
      expect(stale.rawPayload).toEqual(png);
      const invalid = await app.inject({
        url,
        headers: { range: `bytes=${png.length}-` },
      });
      expect(invalid.statusCode).toBe(416);
      expect(invalid.headers["content-range"]).toBe(`bytes */${png.length}`);
      expect(invalid.headers["cache-control"]).toContain("no-store");
    });

    it.each(["text/html", "image/svg+xml", "application/javascript", null])(
      "never serves active content type %s",
      async (mime) => {
        await db.query("update asset_objects set mime_type=$2 where id=$1", [
          object,
          mime,
        ]);
        const response = await app.inject(`/api/gallery/${gallery}/media`);
        expect(response.statusCode).toBe(404);
        expect(response.headers["cache-control"]).toContain("no-store");
      },
    );

    it("requires both generated and stored media ownership to match the publication owner", async () => {
      await db.query("update asset_objects set created_by=$2 where id=$1", [
        object,
        peer,
      ]);
      expect(
        (await app.inject(`/api/gallery/${gallery}/media`)).statusCode,
      ).toBe(404);
      await db.query("update asset_objects set created_by=$2 where id=$1", [
        object,
        owner,
      ]);
      await db.query("update generated_assets set created_by=$2 where id=$1", [
        asset,
        peer,
      ]);
      expect(
        (await app.inject(`/api/gallery/${gallery}/media`)).statusCode,
      ).toBe(404);
      expect((await app.inject("/api/gallery")).json().data).toHaveLength(0);
      expect(
        (await app.inject(`/api/gallery/${gallery}/comments`)).statusCode,
      ).toBe(404);
    });

    it("does not trust a safe MIME label on active HTML or SVG bytes", async () => {
      for (const text of [
        "<!doctype html><script>alert(1)</script>",
        "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>",
      ]) {
        await writeFile(join(root, "private-try-on", objectPath), text);
        const response = await app.inject(`/api/gallery/${gallery}/media`);
        expect(response.statusCode).toBe(404);
        expect(response.body).not.toContain(text);
      }
    });

    it.each([
      ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])],
      ["image/webp", Buffer.from("RIFF0000WEBPVP8 ")],
      ["image/gif", Buffer.from("GIF89a1234567890")],
      [
        "image/avif",
        Buffer.concat([
          Buffer.from([0, 0, 0, 16]),
          Buffer.from("ftypavif0000"),
        ]),
      ],
    ])(
      "accepts the safe %s signature with matching declared type",
      async (mime, bytes) => {
        await writeFile(join(root, "private-try-on", objectPath), bytes);
        await db.query("update asset_objects set mime_type=$2 where id=$1", [
          object,
          mime,
        ]);
        const response = await app.inject(`/api/gallery/${gallery}/media`);
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toBe(mime);
        expect(response.rawPayload).toEqual(bytes);
      },
    );

    it("streams allowed video ranges without granting access to mismatched media metadata", async () => {
      const video = Buffer.concat([
        Buffer.from([0, 0, 0, 16]),
        Buffer.from("ftypisom"),
        Buffer.from([0, 0, 0, 1]),
        Buffer.from("range-fixture"),
      ]);
      await writeFile(join(root, "private-try-on", objectPath), video);
      await db.query(
        "update asset_objects set mime_type='video/mp4' where id=$1",
        [object],
      );
      expect(
        (await app.inject(`/api/gallery/${gallery}/media`)).statusCode,
      ).toBe(404);
      await db.query(
        "update generated_assets set media_type='video',mime_type='video/mp4' where id=$1",
        [asset],
      );
      const response = await app.inject({
        url: `/api/gallery/${gallery}/media`,
        headers: { range: "bytes=4-7" },
      });

      expect(response.statusCode).toBe(206);
      expect(response.rawPayload.toString()).toBe("ftyp");
      expect(response.headers["content-type"]).toBe("video/mp4");
    });

    it("does not expose an unlisted private asset or an object id as a gallery id", async () => {
      expect(
        (await app.inject(`/api/gallery/${object}/media`)).statusCode,
      ).toBe(404);
      await db.query("delete from gallery_items where id=$1", [gallery]);
      expect(
        (await app.inject(`/api/gallery/${gallery}/media`)).statusCode,
      ).toBe(404);
    });

    it("rejects a link resolving outside configured storage", async () => {
      const outside = join(folder, `outside-${object}`);
      await mkdir(outside);
      await writeFile(join(outside, "image.png"), png);
      const link = join(root, "private-try-on", `link-${object}`);
      await symlink(
        outside,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
      const path = `link-${object}/image.png`;
      await db.query("update asset_objects set object_path=$2 where id=$1", [
        object,
        path,
      ]);
      await db.query("update generated_assets set object_path=$2 where id=$1", [
        asset,
        path,
      ]);
      expect(
        (await app.inject(`/api/gallery/${gallery}/media`)).statusCode,
      ).toBe(404);
    });

    it("rejects path traversal and does not fall back to unrelated legacy files", async () => {
      await db.query("update asset_objects set object_path=$2 where id=$1", [
        object,
        "../../outside.png",
      ]);
      await db.query("update generated_assets set object_path=$2 where id=$1", [
        asset,
        "../../outside.png",
      ]);
      expect(
        (await app.inject(`/api/gallery/${gallery}/media`)).statusCode,
      ).toBe(404);
    });
  },
);
