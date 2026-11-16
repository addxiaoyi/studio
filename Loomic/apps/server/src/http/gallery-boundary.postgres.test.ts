import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerLocalGrowthRoutes } from "./local-growth.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)(
  "gallery publication boundary",
  () => {
    const schema = `gallery_boundary_${randomUUID().replaceAll("-", "")}`;
    const owner = randomUUID();
    const peer = randomUUID();
    const workspace = randomUUID();
    const app = Fastify();
    let admin: Pool;
    let db: Pool;
    let asset: string;
    let object: string;
    let gallery: string;

    beforeAll(async () => {
      const url = new URL(process.env.HELT_TEST_DATABASE_URL ?? "");
      if (url.hostname !== "127.0.0.1")
        throw new Error("Gallery tests require loopback PostgreSQL");
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
        "insert into app_users(id,email) values($1,'owner@gallery.test'),($2,'peer@gallery.test')",
        [owner, peer],
      );
      await db.query(
        "insert into workspaces(id,owner_user_id,name) values($1,$2,'Gallery')",
        [workspace, owner],
      );
      await db.query(
        "insert into workspace_members(workspace_id,user_id) values($1,$2),($1,$3)",
        [workspace, owner, peer],
      );
      registerLocalGrowthRoutes(app, {
        db,
        auth: {
          authenticate: async (request) => {
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
        },
        viewerService: {
          ensureViewer: async (user) =>
            ({
              workspace: { id: workspace },
              profile: { id: user.id },
            }) as never,
        },
      });
      await app.ready();
    });
    beforeEach(async () => {
      await db.query(
        "truncate generated_assets cascade; truncate asset_objects cascade",
      );
      asset = randomUUID();
      object = randomUUID();
      gallery = randomUUID();
      await db.query(
        "insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type) values($1,$2,$3,'private-video',$4,'video/mp4')",
        [object, workspace, owner, asset],
      );
      await db.query(
        "insert into generated_assets(id,workspace_id,created_by,media_type,object_path,mime_type,title) values($1::uuid,$2,$3,'video',($1::uuid)::text,'video/mp4','Gallery test')",
        [asset, workspace, owner],
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
    });
    const mutate = (
      path: string,
      payload?: Record<string, unknown>,
      user = owner,
    ) =>
      app.inject({
        method: "POST",
        url: path,
        headers: { authorization: user },
        ...(payload === undefined ? {} : { payload }),
      });

    it.each(["hidden", "removed", "draft"])(
      "does not expose comments or accept social actions on %s items",
      async (status) => {
        await db.query(
          "insert into gallery_comments(gallery_id,user_id,body,request_id) values($1,$2,'private discussion',$3)",
          [gallery, owner, randomUUID()],
        );
        await db.query("update gallery_items set status=$2 where id=$1", [
          gallery,
          status,
        ]);
        const comments = await app.inject(`/api/gallery/${gallery}/comments`);
        expect(comments.statusCode).toBe(404);
        expect(comments.body).not.toContain("private discussion");
        expect((await mutate(`/api/gallery/${gallery}/like`)).statusCode).toBe(
          404,
        );
        expect(
          (
            await mutate(`/api/gallery/${gallery}/comments`, {
              body: "hidden comment",
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (await db.query("select count(*)::int as total from gallery_likes"))
            .rows[0].total,
        ).toBe(0);
      },
    );
    it.each(["soft_deleted", "purged", "expired"])(
      "keeps %s assets out of the feed and prevents publication from restoring them",
      async (state) => {
        await db.query(
          "update generated_assets set retention_state=$2,deleted_at=case when $2='soft_deleted' then now() else null end,retention_until=case when $3 then now()-interval '1 second' else now()+interval '1 day' end where id=$1",
          [asset, state === "expired" ? "active" : state, state === "expired"],
        );
        expect((await app.inject("/api/gallery")).json().data).toHaveLength(0);
        expect(
          (
            await mutate(`/api/gallery/${object}/publish`, {
              title: "must not revive",
            })
          ).statusCode,
        ).toBe(404);
        const row = (
          await db.query(
            "select retention_state,title,deleted_at from generated_assets where id=$1",
            [asset],
          )
        ).rows[0];
        expect(row.title).toBe("Gallery test");
        if (state === "soft_deleted") expect(row.deleted_at).not.toBeNull();
        expect(
          (await app.inject(`/api/gallery/${gallery}/comments`)).statusCode,
        ).toBe(404);
      },
    );
    it("rejects private asset favorites by another workspace member", async () => {
      expect(
        (await mutate(`/api/assets/${asset}/favorite`, undefined, peer))
          .statusCode,
      ).toBe(404);
      expect(
        (await db.query("select count(*)::int as total from asset_favorites"))
          .rows[0].total,
      ).toBe(0);
    });
    it("publishes, withdraws and republishes an owned active asset without granting peer mutation", async () => {
      const changed = await mutate(`/api/gallery/${object}/publish`, {
        title: "Updated title",
      });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(changed.json().data.asset_id).toBe(asset);
      expect(
        (
          await mutate(
            `/api/gallery/${asset}/publish`,
            { title: "peer overwrite" },
            peer,
          )
        ).statusCode,
      ).toBe(404);
      const hidden = await app.inject({
        method: "DELETE",
        url: `/api/gallery/${object}/publish`,
        headers: { authorization: owner },
      });
      expect(hidden.statusCode).toBe(200);
      expect((await app.inject("/api/gallery")).json().data).toHaveLength(0);
      expect((await mutate(`/api/gallery/${asset}/publish`)).statusCode).toBe(
        200,
      );
      expect((await app.inject("/api/gallery")).json().data[0].title).toBe(
        "Updated title",
      );
    });
    it("creates metadata for an owned upload without extending its remaining retention", async () => {
      const upload = randomUUID();
      await db.query(
        "insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type,created_at) values($1,$2,$3,'private-try-on',$4,'image/png',now()-interval '2 days')",
        [upload, workspace, owner, upload],
      );
      const response = await mutate(`/api/gallery/${upload}/publish`);
      expect(response.statusCode, response.body).toBe(200);
      const stored = (
        await db.query(
          "select ga.retention_until=ao.created_at+interval '3 days' as same_deadline from generated_assets ga join asset_objects ao on ao.workspace_id=ga.workspace_id and ao.object_path=ga.object_path where ao.id=$1",
          [upload],
        )
      ).rows[0];
      expect(stored.same_deadline).toBe(true);
    });
    it("rolls back metadata edits when publishing fails", async () => {
      await db.query(
        "create function fail_gallery_publish() returns trigger language plpgsql as $$ begin raise exception 'publish-sensitive-diagnostic'; end $$; create trigger fail_gallery_publish before update of status on gallery_items for each row execute function fail_gallery_publish()",
      );
      try {
        const failed = await mutate(`/api/gallery/${asset}/publish`, {
          title: "must roll back",
        });
        expect(failed.statusCode).toBe(500);
        expect(failed.body).not.toContain("publish-sensitive-diagnostic");
        expect(
          (
            await db.query("select title from generated_assets where id=$1", [
              asset,
            ])
          ).rows[0].title,
        ).toBe("Gallery test");
      } finally {
        await db.query(
          "drop trigger fail_gallery_publish on gallery_items; drop function fail_gallery_publish()",
        );
      }
    });
    it("ignores invalid dimension metadata instead of failing the public feed", async () => {
      await db.query("update generated_assets set metadata=$2 where id=$1", [
        asset,
        { width: "9999999999999999999999", height: "1080" },
      ]);
      const reply = await app.inject("/api/gallery");
      expect(reply.statusCode).toBe(200);
      expect(reply.json().data[0]).toMatchObject({ width: null, height: 1080 });
    });
    it("replays the same comment without editing another gallery or resurrecting removed comments", async () => {
      const requestId = randomUUID();
      const first = await mutate(`/api/gallery/${gallery}/comments`, {
        body: "original",
        requestId,
      });
      expect(first.statusCode).toBe(200);
      const id = first.json().data.id;
      expect(first.json().data.comment_count).toBe(1);
      const repeat = await mutate(`/api/gallery/${gallery}/comments`, {
        body: "original",
        requestId,
      });
      expect(repeat.json().data.id).toBe(id);
      expect(repeat.json().data.comment_count).toBe(1);
      expect(
        (
          await mutate(`/api/gallery/${gallery}/comments`, {
            body: "changed",
            requestId,
          })
        ).statusCode,
      ).toBe(409);
      const otherAsset = randomUUID();
      const otherGallery = randomUUID();
      await db.query(
        "insert into generated_assets(id,workspace_id,created_by,media_type,object_path,title) values($1::uuid,$2,$3,'image',($1::uuid)::text,'other')",
        [otherAsset, workspace, owner],
      );
      await db.query(
        "insert into gallery_items(id,asset_id,workspace_id,owner_id,status) values($1,$2,$3,$4,'published')",
        [otherGallery, otherAsset, workspace, owner],
      );
      expect(
        (
          await mutate(`/api/gallery/${otherGallery}/comments`, {
            body: "original",
            requestId,
          })
        ).statusCode,
      ).toBe(409);
      const removed = await app.inject({
        method: "DELETE",
        url: `/api/gallery/comments/${id}`,
        headers: { authorization: owner },
      });
      expect(removed.statusCode).toBe(200);
      expect(removed.json().data).toEqual({ id, comment_count: 0 });
      expect(
        (
          await mutate(`/api/gallery/${gallery}/comments`, {
            body: "original",
            requestId,
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await db.query(
            "select body,status from gallery_comments where id=$1",
            [id],
          )
        ).rows[0],
      ).toEqual({ body: "original", status: "removed" });
    });
    it("serializes concurrent likes and keeps the cached count consistent", async () => {
      const replies = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          mutate(
            `/api/gallery/${gallery}/like`,
            undefined,
            i % 2 ? owner : peer,
          ),
        ),
      );
      expect(replies.map((reply) => reply.statusCode)).toEqual(
        Array(12).fill(200),
      );
      expect(replies.filter((reply) => reply.json().data.liked)).toHaveLength(
        6,
      );
      const row = (
        await db.query(
          "select like_count,(select count(*)::int from gallery_likes where gallery_id=$1) as actual from gallery_items where id=$1",
          [gallery],
        )
      ).rows[0];
      expect(row).toEqual({ like_count: 0, actual: 0 });
    });
    it("allows public comments without granting anonymous deletion and rejects cross-user deletion", async () => {
      const created = await mutate(`/api/gallery/${gallery}/comments`, {
        body: "public discussion",
      });
      const id = created.json().data.id;
      const listed = await app.inject(`/api/gallery/${gallery}/comments`);
      expect(listed.statusCode).toBe(200);
      expect(listed.json().data[0]).toMatchObject({
        body: "public discussion",
        can_delete: false,
      });
      const denied = await app.inject({
        method: "DELETE",
        url: `/api/gallery/comments/${id}`,
        headers: { authorization: peer },
      });
      expect(denied.statusCode).toBe(404);
      expect(
        (
          await db.query(
            "select comment_count from gallery_items where id=$1",
            [gallery],
          )
        ).rows[0].comment_count,
      ).toBe(1);
    });
    it("rolls back comment creation when its count update fails", async () => {
      await db.query(
        "create function fail_gallery_count() returns trigger language plpgsql as $$ begin raise exception 'counter-sensitive-diagnostic'; end $$; create trigger fail_gallery_count before update of comment_count on gallery_items for each row execute function fail_gallery_count()",
      );
      try {
        const reply = await mutate(`/api/gallery/${gallery}/comments`, {
          body: "must roll back",
        });
        expect(reply.statusCode).toBe(500);
        expect(reply.body).not.toContain("counter-sensitive-diagnostic");
        expect(
          (
            await db.query(
              "select count(*)::int as total from gallery_comments",
            )
          ).rows[0].total,
        ).toBe(0);
      } finally {
        await db.query(
          "drop trigger fail_gallery_count on gallery_items; drop function fail_gallery_count()",
        );
      }
    });
    it.each([
      "/api/gallery?limit=NaN",
      "/api/gallery?limit=-1",
      "/api/assets/history?page=Infinity",
      "/api/assets/history?pageSize=0",
      "/api/assets/history?page=1.5",
    ])("rejects invalid query %s", async (url) => {
      expect(
        (await app.inject({ url, headers: { authorization: owner } }))
          .statusCode,
      ).toBe(400);
    });
    it("rejects malformed ids and comment bodies before SQL", async () => {
      expect(
        (await app.inject("/api/gallery/not-uuid/comments")).statusCode,
      ).toBe(400);
      expect(
        (
          await mutate(`/api/gallery/${gallery}/comments`, {
            body: { text: "not a string" },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await mutate(`/api/gallery/${gallery}/comments`, {
            body: "text",
            requestId: "not-uuid",
          })
        ).statusCode,
      ).toBe(400);
    });
  },
);
