import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalCreditService } from "../local-db/credit-service.js";
import { buildEpaySign } from "../features/payments/epay-client.js";
import { registerEpayRoutes } from "./epay.js";
import { registerCreditRoutes } from "./credits.js";

const databaseUrl = process.env.HELT_TEST_DATABASE_URL;
const schema = `epay_${randomUUID().replaceAll("-", "")}`;
const merchantId = "release-test-merchant";
const key = "isolated-callback-signing-key";
let admin: Pool;
let db: Pool;

describe.skipIf(!databaseUrl)("Epay with real PostgreSQL credits", () => {
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl!).hostname)) {
      throw new Error("Payment regression requires a local database");
    }
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema ${schema}`);
    db = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(await readFile(new URL("../local-db/schema.sql", import.meta.url), "utf8"));
  });

  afterAll(async () => {
    await db?.end();
    if (!admin) return;
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  });

  async function fixture(amount = 1000) {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    await db.query("insert into app_users(id,email) values($1,$2)", [userId, `${userId}@example.test`]);
    await db.query("insert into workspaces(id,owner_user_id,name) values($1,$2,'Payment regression')", [workspaceId, userId]);
    const credits = createLocalCreditService(db);
    const order = await credits.createCustomTopupOrder!(workspaceId, amount, "epay");
    const auth = { authenticate: async () => ({ id: userId, email: `${userId}@example.test`, accessToken: "test", userMetadata: {} }) };
    const viewerService = { ensureViewer: async () => ({ workspace: { id: workspaceId } }) };
    const app = Fastify();
    registerEpayRoutes(app, { auth, viewerService: viewerService as never, creditService: credits,
      baseUrl: "https://pay.example.test", merchantId, md5Key: key, notifyUrl: "https://studio.example.test/api/epay/notify" });
    await registerCreditRoutes(app, { auth, viewerService: viewerService as never, creditService: credits });
    function notify(overrides: Record<string, string> = {}) {
      const payload = { pid: merchantId, trade_no: `trade-${order.outTradeNo}`, out_trade_no: order.outTradeNo,
        money: (amount / 100).toFixed(2), trade_status: "TRADE_SUCCESS", ...overrides };
      return app.inject({ method: "POST", url: "/api/epay/notify",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({ ...payload, sign: buildEpaySign(payload, key), sign_type: "MD5" }).toString() });
    }
    return { app, credits, order, workspaceId, userId, notify };
  }

  it("credits a paid order exactly once across concurrent callback retries", async () => {
    const f = await fixture();
    try {
      const replies = await Promise.all(Array.from({ length: 8 }, () => f.notify()));
      expect(replies.map(reply => reply.statusCode)).toEqual(Array(8).fill(200));
      expect(replies.every(reply => reply.body === "success")).toBe(true);
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(10);
      const transactions = await f.credits.getTransactions(f.workspaceId);
      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({ transaction_type: "topup", amount: 10, balance_after: 10 });
      expect(await f.credits.getTopupOrder(f.order.outTradeNo, f.workspaceId)).toMatchObject({ status: "paid" });
    } finally { await f.app.close(); }
  });

  it("keeps customer order lookup scoped to its workspace", async () => {
    const owner = await fixture();
    const stranger = await fixture();
    try {
      expect(await owner.credits.getTopupOrder(owner.order.outTradeNo, stranger.workspaceId)).toBeNull();
      const response = await stranger.app.inject({ method: "GET", url: `/api/credits/topup/${owner.order.outTradeNo}` });
      expect(response.statusCode).toBe(404);
      expect(await owner.credits.getTopupOrder(owner.order.outTradeNo, owner.workspaceId)).not.toBeNull();
    } finally { await owner.app.close(); await stranger.app.close(); }
  });

  it("rejects mismatched amount, merchant and payment channel without crediting", async () => {
    const f = await fixture();
    try {
      expect((await f.notify({ money: "9.99" })).statusCode).toBe(400);
      expect((await f.notify({ pid: "another-merchant" })).statusCode).toBe(401);
      expect((await f.notify({ pid: "" })).statusCode).toBe(401);
      await db.query("update credit_topups set provider='manual' where out_trade_no=$1", [f.order.outTradeNo]);
      expect((await f.notify()).statusCode).toBe(400);
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(0);
      expect(await f.credits.getTransactions(f.workspaceId)).toEqual([]);
    } finally { await f.app.close(); }
  });

  it("rejects fractional-yuan payments before creating a payable order", async () => {
    const f = await fixture();
    try {
      await expect(f.credits.createCustomTopupOrder!(f.workspaceId, 1050, "epay")).rejects.toMatchObject({ statusCode: 400 });
      const response = await f.app.inject({ method: "POST", url: "/api/epay/topup", payload: { amountCnyFen: 1050 } });
      expect(response.statusCode).toBe(400);
      expect((await db.query("select count(*)::int as n from credit_topups where workspace_id=$1", [f.workspaceId])).rows[0].n).toBe(1);
    } finally { await f.app.close(); }
  });

  it("deducts and refunds one job once under repeated requests", async () => {
    const f = await fixture();
    try {
      expect((await f.notify()).statusCode).toBe(200);
      const jobId = randomUUID();
      const charges = await Promise.all(Array.from({ length: 5 }, () => f.credits.deductCredits(f.workspaceId, f.userId, 2, jobId)));
      expect(new Set(charges).size).toBe(1);
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(8);
      const refunds = await Promise.all(Array.from({ length: 5 }, () => f.credits.refundCredits(f.workspaceId, f.userId, 2, jobId)));
      expect(new Set(refunds).size).toBe(1);
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(10);
    } finally { await f.app.close(); }
  });
});
