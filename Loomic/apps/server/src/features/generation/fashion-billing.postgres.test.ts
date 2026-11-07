import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerGenerationApprovalRoutes } from "../../http/generation-approvals.js";
import { createLocalJobService } from "../../local-db/job-service.js";
import { createLocalCreditService } from "../../local-db/credit-service.js";
import { createGenerationApprovalService } from "./generation-approval-service.js";

const databaseUrl = process.env.HELT_TEST_DATABASE_URL;
const schema = `fashion_billing_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let db: Pool;

describe.skipIf(!databaseUrl)("try-on billing with PostgreSQL", () => {
  beforeAll(async () => {
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(databaseUrl!).hostname,
      )
    )
      throw new Error("Billing tests require a local database.");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema ${schema}`);
    db = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`,
    });
    await db.query(
      await readFile(
        new URL("../../local-db/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.query(
      await readFile(
        new URL(
          "../../local-db/migrations/20261018000000_dedupe_pending_generation_approvals.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const connectorMigration = await readFile(
      new URL(
        "../../local-db/migrations/20261031000000_agent_muse_workspace.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.query(
      connectorMigration.slice(
        connectorMigration.indexOf(
          "create table if not exists agent_connector_permissions",
        ),
        connectorMigration.indexOf(
          "create table if not exists agent_goal_outputs",
        ),
      ),
    );
    const freeConfirmation = await readFile(
      new URL(
        "../../local-db/migrations/20261107000000_free_generation_confirmation.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.query(freeConfirmation);
    await db.query(freeConfirmation);
  });
  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop schema if exists ${schema} cascade`);
      await admin.end();
    }
  });

  async function fixture(cost = 3.5) {
    const userId = randomUUID(),
      workspaceId = randomUUID();
    await db.query("insert into app_users(id,email) values($1,$2)", [
      userId,
      `${userId}@example.test`,
    ]);
    await db.query(
      "insert into workspaces(id,owner_user_id,name) values($1,$2,'Billing test')",
      [workspaceId, userId],
    );
    await db.query(
      "insert into workspace_settings(workspace_id,default_model,auto_approve_paid_generation) values($1,'try-on',true)",
      [workspaceId],
    );
    await db.query(
      "insert into credit_balances(workspace_id,balance) values($1,100)",
      [workspaceId],
    );
    const user = {
      id: userId,
      accessToken: "test",
      email: "billing@example.test",
      userMetadata: {},
    };
    const jobs = createLocalJobService(db),
      credits = createLocalCreditService(db),
      approvals = createGenerationApprovalService(db);
    const app = Fastify();
    registerGenerationApprovalRoutes(app, {
      db,
      jobService: jobs,
      creditService: credits,
      auth: { authenticate: async () => user },
      viewerService: {
        ensureViewer: async () => ({ workspace: { id: workspaceId } }),
      } as never,
    });
    const input = {
      workspaceId,
      userId,
      jobType: "image_generation" as const,
      model: "try-on",
      payload: {
        purpose: "try-on",
        model: "try-on",
        prompt: "try on",
        input_asset_ids: [randomUUID(), randomUUID()],
      },
      estimatedCredits: cost,
      forceConfirmation: true,
    };
    const quoted = await approvals.gate(input);
    if (quoted.state !== "confirmation_required")
      throw new Error("Try-on bypassed per-request confirmation.");
    const approvalId = quoted.request.approvalId;
    const confirm = () =>
      app.inject({
        method: "POST",
        url: `/api/generation-approvals/${approvalId}/confirm`,
      });
    return {
      app,
      input,
      approvalId,
      confirm,
      jobs,
      credits,
      approvals,
      userId,
      workspaceId,
    };
  }

  it("creates and charges one job under concurrent confirmation and lost-response retries", async () => {
    const f = await fixture();
    try {
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(100);
      expect((await f.jobs.listJobs({ id: f.userId } as never)).length).toBe(0);
      const replies = await Promise.all(Array.from({ length: 8 }, f.confirm));
      expect(replies.map((reply) => reply.statusCode)).toEqual(
        Array(8).fill(200),
      );
      const jobId = replies[0]!.json().data.jobId;
      expect(
        new Set(replies.map((reply) => reply.json().data.jobId)).size,
      ).toBe(1);
      expect((await f.confirm()).json().data.jobId).toBe(jobId);
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(96.5);
      expect(await f.credits.getTransactions(f.workspaceId)).toHaveLength(1);
      expect(await f.jobs.listJobs({ id: f.userId } as never)).toHaveLength(1);
      expect(await f.jobs.claimJob(jobId)).not.toBeNull();
      expect(await f.jobs.claimJob(jobId)).toBeNull();
    } finally {
      await f.app.close();
    }
  });

  it("blocks rejected and expired confirmations without charging", async () => {
    for (const state of ["rejected", "expired"]) {
      const f = await fixture();
      try {
        if (state === "rejected")
          await f.approvals.reject({
            approvalId: f.approvalId,
            workspaceId: f.workspaceId,
            userId: f.userId,
          });
        else
          await db.query(
            "update generation_approvals set expires_at=now()-interval '1 second' where id=$1",
            [f.approvalId],
          );
        expect((await f.confirm()).statusCode).toBe(409);
        expect(await f.jobs.listJobs({ id: f.userId } as never)).toHaveLength(
          0,
        );
        expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(100);
      } finally {
        await f.app.close();
      }
    }
  });

  it("rejects changed references and price before consuming the approved quote", async () => {
    const f = await fixture();
    try {
      await f.approvals.approve({
        approvalId: f.approvalId,
        workspaceId: f.workspaceId,
        userId: f.userId,
      });
      for (const patch of [
        { estimatedCredits: 7 },
        {
          payload: {
            ...f.input.payload,
            input_asset_ids: [randomUUID(), randomUUID()],
          },
        },
      ]) {
        await expect(
          f.approvals.gate({ ...f.input, ...patch, approvalId: f.approvalId }),
        ).rejects.toMatchObject({ code: "generation_approval_invalid" });
      }
      const claims = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          f.approvals.gate({ ...f.input, approvalId: f.approvalId }),
        ),
      );
      expect(
        claims.filter((claim) => claim.status === "fulfilled"),
      ).toHaveLength(1);
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(100);
    } finally {
      await f.app.close();
    }
  });

  it("does not let a worker run before the approved cost is reserved", async () => {
    const f = await fixture();
    try {
      const job = await f.jobs.createJob({ id: f.userId } as never, {
        workspaceId: f.workspaceId,
        jobType: "image_generation",
        idempotencyKey: `approval:${f.approvalId}`,
        payload: f.input.payload,
      });
      expect(await f.jobs.claimJob(job.id)).toBeNull();
      expect((await f.confirm()).statusCode).toBe(200);
      expect(await f.jobs.claimJob(job.id)).not.toBeNull();
    } finally {
      await f.app.close();
    }
  });

  it("does not report a confirmed or unknown quote as canceled", async () => {
    const f = await fixture();
    try {
      expect((await f.confirm()).statusCode).toBe(200);
      const cancel = (id: string) =>
        f.app.inject({
          method: "POST",
          url: `/api/generation-approvals/${id}/cancel`,
        });
      expect((await cancel(f.approvalId)).statusCode).toBe(409);
      expect((await cancel(randomUUID())).statusCode).toBe(409);
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(96.5);
    } finally {
      await f.app.close();
    }
  });

  it("requires confirmation for a free try-on and allows the confirmed job without a debit", async () => {
    const f = await fixture(0);
    try {
      const reply = await f.confirm();
      expect(reply.statusCode).toBe(200);
      expect(await f.jobs.claimJob(reply.json().data.jobId)).not.toBeNull();
      expect(await f.credits.getTransactions(f.workspaceId)).toHaveLength(0);
    } finally {
      await f.app.close();
    }
  });
});
