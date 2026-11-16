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
import { registerLocalGrowthRoutes } from "./local-growth.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)(
  "published prompt catalog transactions",
  () => {
    const schema = `prompt_catalog_${randomUUID().replaceAll("-", "")}`;
    const owner = randomUUID();
    const peer = randomUUID();
    const published = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    const draft = randomUUID();
    const deleted = randomUUID();
    const app = Fastify();
    let admin: Pool;
    let db: Pool;

    beforeAll(async () => {
      const url = new URL(process.env.HELT_TEST_DATABASE_URL ?? "");
      if (url.hostname !== "127.0.0.1")
        throw new Error("Prompt tests require loopback PostgreSQL");
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
        "insert into app_users(id,email) values($1,'owner@prompt.test'),($2,'peer@prompt.test')",
        [owner, peer],
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
                  email: "prompt@test.invalid",
                  userMetadata: {},
                }
              : null;
          },
        },
        viewerService: { ensureViewer: vi.fn() },
      });
      await app.ready();
    });

    beforeEach(async () => {
      await db.query("truncate prompt_entries cascade");
      await db.query(
        `insert into prompt_entries(id,title,prompt,category,published,deleted_at,created_at) values
      ($1,'Published first','first','photo',true,null,'2026-01-01'),
      ($2,'Published second','second','photo',true,null,'2026-01-01'),
      ($3,'Secret draft','draft','private',false,null,'2026-01-01'),
      ($4,'Deleted','removed','private',true,now(),'2026-01-01')`,
        [published, second, draft, deleted],
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

    const mutate = (id: string, action: "view" | "favorite", user = owner) =>
      app.inject({
        method: "POST",
        url: `/api/prompts/${id}/${action}`,
        headers: { authorization: user },
      });

    it("paginates equal-ranked prompts consistently and excludes unpublished and removed metadata", async () => {
      const first = await app.inject("/api/prompts?limit=1");
      const next = await app.inject("/api/prompts?limit=1&offset=1");
      expect(first.json().data.map((row: { id: string }) => row.id)).toEqual([
        second,
      ]);
      expect(first.json().pagination.hasMore).toBe(true);
      expect(next.json().data.map((row: { id: string }) => row.id)).toEqual([
        published,
      ]);
      expect(next.json().pagination.hasMore).toBe(false);
      expect(first.json().categories).toEqual([
        { category: "photo", count: 2 },
      ]);
    });

    it("rejects private, deleted and absent prompt mutations without creating favorites", async () => {
      for (const id of [draft, deleted, randomUUID()]) {
        expect((await mutate(id, "favorite")).statusCode).toBe(404);
        expect((await mutate(id, "view")).statusCode).toBe(404);
      }
      expect(
        (await db.query("select count(*)::int as count from prompt_favorites"))
          .rows[0].count,
      ).toBe(0);
      expect(
        (
          await db.query(
            "select sum(view_count)::int as count from prompt_entries",
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/prompts/${published}/favorite`,
          })
        ).statusCode,
      ).toBe(401);
    });

    it("serializes concurrent toggles and keeps the stored favorite count exact", async () => {
      const replies = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          mutate(published, "favorite", index % 2 ? owner : peer),
        ),
      );
      expect(replies.map((reply) => reply.statusCode)).toEqual(
        Array(12).fill(200),
      );
      expect(
        replies.filter((reply) => reply.json().data.favorited),
      ).toHaveLength(6);
      const actual = await db.query(
        "select favorite_count,(select count(*)::int from prompt_favorites where prompt_id=$1) as actual from prompt_entries where id=$1",
        [published],
      );
      expect(actual.rows[0]).toEqual({ favorite_count: 0, actual: 0 });
    });

    it("rolls back a favorite if the counter cannot be persisted", async () => {
      await db.query(`create function reject_prompt_count() returns trigger language plpgsql as $$ begin raise exception 'private-counter-diagnostic'; end $$;
      create trigger reject_prompt_count before update of favorite_count on prompt_entries for each row execute function reject_prompt_count()`);
      try {
        const failed = await mutate(published, "favorite");
        expect(failed.statusCode).toBe(500);
        expect(failed.body).not.toContain("private-counter-diagnostic");
        expect(
          (
            await db.query(
              "select count(*)::int as count from prompt_favorites",
            )
          ).rows[0].count,
        ).toBe(0);
        expect(
          (
            await db.query(
              "select favorite_count from prompt_entries where id=$1",
              [published],
            )
          ).rows[0].favorite_count,
        ).toBe(0);
      } finally {
        await db.query(
          "drop trigger reject_prompt_count on prompt_entries; drop function reject_prompt_count()",
        );
      }
      expect((await mutate(published, "favorite")).json().data.favorited).toBe(
        true,
      );
    });
  },
);
