import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { registerGalleryRoutes } from "./gallery-routes.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)(
  "explicit Gallery caption publication",
  () => {
    const schema = `gallery_caption_${randomUUID().replaceAll("-", "")}`;
    const owner = randomUUID();
    const peer = randomUUID();
    const workspace = randomUUID();
    const asset = randomUUID();
    const object = randomUUID();
    const app = Fastify();
    let admin: Pool;
    let db: Pool;
    const caption = {
      vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nHello <script> & world\n\n00:01.000 --> 00:02.000\nSecond sentence",
      language: "en",
      label: "English captions",
      consent: true,
    };
    beforeAll(async () => {
      const url = new URL(process.env.HELT_TEST_DATABASE_URL ?? "");
      if (url.hostname !== "127.0.0.1")
        throw new Error("Loopback database required");
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
        await readFile(
          new URL(
            "../local-db/migrations/20261115000000_gallery_captions.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await db.query(
        "insert into app_users(id,email) values($1,'owner@captions.test'),($2,'peer@captions.test')",
        [owner, peer],
      );
      await db.query(
        "insert into workspaces(id,owner_user_id,name) values($1,$2,'Captions')",
        [workspace, owner],
      );
      await db.query(
        "insert into workspace_members(workspace_id,user_id) values($1,$2),($1,$3)",
        [workspace, owner, peer],
      );
      registerGalleryRoutes(app, {
        db,
        auth: {
          authenticate: async (request) =>
            request.headers.authorization === owner ||
            request.headers.authorization === peer
              ? {
                  id: request.headers.authorization,
                  email: "caption@test",
                  accessToken: "token",
                  userMetadata: {},
                }
              : null,
        },
        viewerService: {
          ensureViewer: vi
            .fn()
            .mockResolvedValue({ workspace: { id: workspace } }),
        },
      });
      await app.ready();
    });
    beforeEach(async () => {
      await db.query("delete from gallery_items");
      await db.query("delete from generated_assets");
      await db.query("delete from asset_objects");
      await db.query(
        "insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type,byte_size) values($1,$2,$3,'private-video','video.mp4','video/mp4',100)",
        [object, workspace, owner],
      );
      await db.query(
        "insert into generated_assets(id,workspace_id,created_by,media_type,object_path,mime_type,title) values($1,$2,$3,'video','video.mp4','video/mp4','Video')",
        [asset, workspace, owner],
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
    });
    const publish = (payload: unknown, user = owner) =>
      app.inject({
        method: "POST",
        url: `/api/gallery/${asset}/publish`,
        headers: { authorization: user },
        payload: payload as never,
      });

    it("exposes only owner-selected captions and serializes a safe real VTT", async () => {
      const published = await publish({ caption });
      expect(published.statusCode, published.body).toBe(200);
      const id = published.json().data.id;
      const response = await app.inject(`/api/gallery/${id}/captions.vtt`);
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/vtt");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.body).toContain("Hello &lt;script&gt; &amp; world");
      expect(response.body).not.toContain("<script>");
      const feed = await app.inject("/api/gallery");
      expect(feed.json().data[0].caption).toEqual({
        url: `/api/gallery/${id}/captions.vtt`,
        language: "en",
        label: "English captions",
      });
      expect(feed.body).not.toContain("Second sentence");
      expect(
        (
          await db.query("select metadata from generated_assets where id=$1", [
            asset,
          ])
        ).rows[0].metadata,
      ).not.toHaveProperty("captions");
    });

    it("does not expose a subtitle track when captions were not selected", async () => {
      const published = await publish({});
      const id = published.json().data.id;
      expect(
        (await app.inject(`/api/gallery/${id}/captions.vtt`)).statusCode,
      ).toBe(404);
      expect(
        (await app.inject("/api/gallery")).json().data[0].caption,
      ).toBeNull();
    });

    it.each(["hidden", "deleted", "expired", "orphaned"])(
      "revokes caption GET and HEAD when %s",
      async (state) => {
        const id = (await publish({ caption })).json().data.id;
        if (state === "hidden")
          await app.inject({
            method: "DELETE",
            url: `/api/gallery/${asset}/publish`,
            headers: { authorization: owner },
          });
        if (state === "deleted")
          await db.query(
            "update generated_assets set deleted_at=now() where id=$1",
            [asset],
          );
        if (state === "expired")
          await db.query(
            "update generated_assets set retention_until=now()-interval '1 second' where id=$1",
            [asset],
          );
        if (state === "orphaned")
          await db.query("update gallery_items set owner_id=$2 where id=$1", [
            id,
            peer,
          ]);
        for (const method of ["GET", "HEAD"] as const) {
          const response = await app.inject({
            method,
            url: `/api/gallery/${id}/captions.vtt`,
            headers: { "if-none-match": "anything" },
          });
          expect(response.statusCode).toBe(404);
          expect(response.headers["cache-control"]).toBe("no-store");
        }
      },
    );

    it("rejects peer publication, missing consent, malformed VTT and captions on an image", async () => {
      expect((await publish({ caption }, peer)).statusCode).toBe(404);
      expect(
        (await publish({ caption: { ...caption, consent: false } })).statusCode,
      ).toBe(400);
      expect(
        (await publish({ caption: { ...caption, vtt: "<svg>" } })).statusCode,
      ).toBe(400);
      await db.query(
        "update generated_assets set media_type='image' where id=$1",
        [asset],
      );
      expect((await publish({ caption })).statusCode).toBe(400);
      expect(
        (await db.query("select count(*)::int as n from gallery_items")).rows[0]
          .n,
      ).toBe(0);
    });

    it("republishing without a selection clears the prior caption snapshot", async () => {
      const id = (await publish({ caption })).json().data.id;
      await app.inject({
        method: "DELETE",
        url: `/api/gallery/${asset}/publish`,
        headers: { authorization: owner },
      });
      expect((await publish({})).statusCode).toBe(200);
      expect(
        (await app.inject(`/api/gallery/${id}/captions.vtt`)).statusCode,
      ).toBe(404);
    });
  },
);
