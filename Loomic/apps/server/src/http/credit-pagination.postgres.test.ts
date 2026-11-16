import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalCreditService } from "../local-db/credit-service.js";
import { registerCreditRoutes } from "./credits.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)(
  "credit statement pagination",
  () => {
    const schema = `credit_pagination_${randomUUID().replaceAll("-", "")}`;
    const userId = randomUUID();
    const peerId = randomUUID();
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const transactionIds = Array.from({ length: 105 }, () => randomUUID())
      .sort()
      .reverse();
    const app = Fastify();
    let admin: Pool;
    let db: Pool;

    beforeAll(async () => {
      const url = new URL(process.env.HELT_TEST_DATABASE_URL ?? "");
      if (url.hostname !== "127.0.0.1")
        throw new Error("Credit tests require loopback PostgreSQL");
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
        "insert into app_users(id,email) values($1,'credit-pagination@test.invalid'),($2,'credit-peer@test.invalid')",
        [userId, peerId],
      );
      await db.query(
        "insert into workspaces(id,owner_user_id,name) values($1,$3,'mine'),($2,$4,'other')",
        [workspaceId, otherWorkspaceId, userId, peerId],
      );
      await db.query(
        `insert into credit_transactions(id,workspace_id,user_id,transaction_type,amount,balance_after,description,created_at)
      select id,$2,$3,'bonus',1,1,'page fixture','2026-01-01T00:00:00Z' from unnest($1::uuid[]) id`,
        [transactionIds, workspaceId, userId],
      );
      await db.query(
        "insert into credit_transactions(workspace_id,user_id,transaction_type,amount,balance_after,description) values($1,$2,'bonus',999,999,'private-other-workspace')",
        [otherWorkspaceId, userId],
      );
      await registerCreditRoutes(app, {
        creditService: createLocalCreditService(db),
        auth: {
          authenticate: async (request) =>
            request.headers.authorization
              ? {
                  id: userId,
                  accessToken: "test",
                  email: "credit-pagination@test.invalid",
                  userMetadata: {},
                }
              : null,
        },
        viewerService: {
          ensureViewer: async () =>
            ({ workspace: { id: workspaceId } }) as never,
        },
      });
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

    const get = (query: string) =>
      app.inject({
        url: `/api/credits/transactions?${query}`,
        headers: { authorization: "Bearer test" },
      });

    it("reads the rows beyond the server page limit without repeating tied timestamps or leaking workspaces", async () => {
      const first = await get("limit=100&offset=0");
      const second = await get("limit=100&offset=100");
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(
        first.json().transactions.map((row: { id: string }) => row.id),
      ).toEqual(transactionIds.slice(0, 100));
      expect(
        second.json().transactions.map((row: { id: string }) => row.id),
      ).toEqual(transactionIds.slice(100));
      expect(first.json().pagination).toEqual({
        limit: 100,
        offset: 0,
        hasMore: true,
      });
      expect(second.json().pagination).toEqual({
        limit: 100,
        offset: 100,
        hasMore: false,
      });
      expect(first.headers["cache-control"]).toBe("private, no-store");
    });

    it("does not invent a further page when a page is exactly full", async () => {
      const final = await get("limit=5&offset=100");
      expect(final.json().transactions).toHaveLength(5);
      expect(final.json().pagination.hasMore).toBe(false);
    });

    it.each([
      "limit=101",
      "limit=0",
      "limit=NaN",
      "limit=1.5",
      "offset=-1",
      "offset=Infinity",
      "offset=2.5",
      "limit=1&limit=2",
    ])("rejects invalid paging %s", async (query) => {
      const response = await get(query);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("invalid_transaction_query");
    });

    it("requires authentication before serving a statement", async () => {
      expect(
        (await app.inject("/api/credits/transactions?limit=100&offset=100"))
          .statusCode,
      ).toBe(401);
    });
  },
);
