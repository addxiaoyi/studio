import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalCostGuard } from "./tier-guard.js";

const databaseUrl = process.env.HELT_TEST_DATABASE_URL;
const schema = `price_selection_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let db: Pool;

describe.skipIf(!databaseUrl)("configured price selection in PostgreSQL", () => {
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl!).hostname)) throw new Error("Price tests require a local database");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema ${schema}`);
    db = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(`
      create table provider_configs(id int primary key, enabled boolean, health_status text, latency_ms int);
      create table provider_models(provider_id int, model_id text, media_type text, enabled boolean,
        billing_unit text, price_credits numeric, input_token_price_cny numeric, output_token_price_cny numeric,
        priority int, health_status text, failure_count int, cooldown_until timestamptz, last_error text);
      insert into provider_configs values (1,true,'healthy',1000),(2,true,'healthy',100);
      insert into provider_models values
        (1,'image-routing-fixture','image',true,'per_generation',0.10,null,null,1,'unknown',0,null,null),
        (2,'image-routing-fixture','image',true,'per_generation',0.05,null,null,100,'healthy',0,null,null);
    `);
  });
  afterAll(async () => {
    await db?.end();
    if (admin) { await admin.query(`drop schema if exists ${schema} cascade`); await admin.end(); }
  });

  it("quotes the verified image provider even when an unverified row has higher priority", async () => {
    const guard = createLocalCostGuard(db);
    await expect(guard.calculateCreditCost("image-routing-fixture", "image_generation", { quality: "hd" })).resolves.toBe(0.05);
  });

  it("does not quote a failed or cooling provider ahead of an eligible video provider", async () => {
    await db.query(`insert into provider_models values
      (1,'acceptance-video','video',true,'per_second',3,null,null,1,'unhealthy',3,now()+interval '1 hour',null),
      (2,'acceptance-video','video',true,'per_second',0.432,null,null,100,'unknown',0,null,null)`);
    await expect(createLocalCostGuard(db).calculateCreditCost("acceptance-video", "video_generation", { duration: 4 })).resolves.toBe(1.728);
  });

  it("rejects a missing provider instead of inventing a one-credit price", async () => {
    await expect(createLocalCostGuard(db).calculateCreditCost("missing-model", "image_generation")).rejects.toMatchObject({ code: "model_not_accessible", statusCode: 422 });
  });
});
