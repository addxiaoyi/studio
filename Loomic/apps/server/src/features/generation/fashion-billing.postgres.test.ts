import { randomUUID } from "node:crypto";
import { registerJobRoutes } from "../../http/jobs.js";
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
    const contextScope = await readFile(new URL("../../local-db/migrations/20261114000006_approval_context_scope.sql", import.meta.url), "utf8");
    await db.query(contextScope);
    await db.query(contextScope);
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
    const model = `try-on-${randomUUID()}`;
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
    const providerId = randomUUID();
    await db.query(`insert into provider_configs(id,workspace_id,label,base_url,key_ciphertext,key_last4,health_status)
      values($1,$2,'Test image provider','https://provider.invalid','fixture','test','healthy')`, [providerId, workspaceId]);
    await db.query(`insert into provider_models(provider_id,model_id,display_name,media_type,billing_unit,price_credits,health_status)
      values($1,$2,'Try-on test','image','per_generation',$3,'healthy')`, [providerId, model, cost]);
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
    await registerJobRoutes(app, { localDb: db, jobService: jobs, creditService: credits, auth: { authenticate: async () => user }, viewerService: { ensureViewer: async () => ({ workspace: { id: workspaceId } }) } as never });
    const input = {
      workspaceId,
      userId,
      jobType: "image_generation" as const,
      model,
      payload: {
        purpose: "try-on",
        model,
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

  it("refunds an unstarted cancellation once and never refunds a started task as canceled", async () => {
    const f = await fixture();
    try {
      const jobId = (await f.confirm()).json().data.jobId;
      const cancel = async () => {
        const reply = await f.app.inject({ method: "POST", url: `/api/jobs/${jobId}/cancel` });
        expect(reply.statusCode, reply.body).toBe(200);
      };
      await Promise.all(Array.from({ length: 5 }, cancel));
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(100);
      expect((await f.credits.getTransactions(f.workspaceId)).filter(row=>row.transaction_type === "generation_refund")).toHaveLength(1);
      expect(await f.jobs.claimJob(jobId)).toBeNull();
      const running = await fixture();
      try {
        const runningId = (await running.confirm()).json().data.jobId;
        expect(await running.jobs.claimJob(runningId)).not.toBeNull();
        const canceled = await running.app.inject({ method: "POST", url: `/api/jobs/${runningId}/cancel` });
        expect(canceled.statusCode, canceled.body).toBe(200);
        expect(canceled.json().job).toMatchObject({ status: "running", cancel_requested_at: expect.any(String) });
        const requestedAt = canceled.json().job.cancel_requested_at;
        await running.jobs.updateProgress(runningId, 60, "provider_polling");
        const repeated = await running.app.inject({ method: "POST", url: `/api/jobs/${runningId}/cancel` });
        expect(repeated.json().job.cancel_requested_at).toBe(requestedAt);
        expect((await running.credits.getBalance(running.workspaceId)).balance).toBe(96.5);
        expect((await running.credits.getTransactions(running.workspaceId)).filter(row => row.transaction_type === "generation_refund")).toHaveLength(0);
        expect((await running.jobs.getJob({ id: running.userId } as never, runningId)).status).toBe("running");
        await running.jobs.markSucceeded(runningId, { asset_id: randomUUID() });
        expect((await running.jobs.getJob({ id: running.userId } as never, runningId)).result).toMatchObject({
          cancellation: { requested: true, outcome: "completed_after_cancel_request" },
        });
        expect((await running.credits.getBalance(running.workspaceId)).balance).toBe(96.5);
      } finally { await running.app.close(); }
    } finally { await f.app.close(); }
  });

  for (const media of ["image", "video"] as const) {
    it(`resumes the original unpaid ${media} job only after matching parameters and renewed approval`, async () => {
      const f = await fixture();
      const provider = randomUUID(), model = `resume-${media}-${randomUUID()}`, key = randomUUID();
      const user = { id: f.userId, accessToken: "test", email: "recovery@example.test", userMetadata: {} };
      await db.query("update workspace_settings set auto_approve_paid_generation=false where workspace_id=$1", [f.workspaceId]);
      await db.query(`insert into provider_configs(id,workspace_id,label,base_url,key_ciphertext,key_last4,health_status)
        values($1,$2,'recovery','https://provider.invalid','fixture','test','healthy')`, [provider, f.workspaceId]);
      await db.query(`insert into provider_models(provider_id,model_id,display_name,media_type,billing_unit,price_credits,health_status)
        values($1,$2,'Recovery',$3,'per_generation',0.3,'healthy')`, [provider, model, media]);
      const payload = { model, prompt: "original request", ...(media === "video" ? { duration: 10, enable_audio: false } : {}) };
      const pending = await f.jobs.createJob(user, { workspaceId: f.workspaceId, jobType: `${media}_generation`,
        payload, idempotencyKey: key, requiresCreditReservation: true });
      const app = Fastify();
      let currentQuote = 2;
      await registerJobRoutes(app, { localDb: db, jobService: f.jobs, creditService: f.credits,
        auth: { authenticate: async () => user }, viewerService: { ensureViewer: async () => ({ workspace: { id: f.workspaceId } }) } as never,
        tierGuard: { checkModelAccess: async () => {}, checkConcurrency: async () => {}, checkResolution() {}, checkVideoResolution() {},
          calculateCreditCost: async () => currentQuote },
      });
      const send = (body: Record<string, unknown>, approvalId?: string) => app.inject({ method: "POST", url: `/api/jobs/${media}-generation`,
        headers: { "idempotency-key": key, ...(approvalId ? { "x-generation-approval": approvalId } : {}) }, payload: body });
      try {
        for (const changed of [{ ...payload, prompt: "another request" }, { ...payload, input_asset_ids: [randomUUID()] },
          { ...payload, project_id: randomUUID() }, { ...payload, model: "another-model" }]) {
          expect((await send(changed)).statusCode).toBe(409);
        }
        expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(100);
        const quote = await send(payload);
        expect(quote.statusCode, quote.body).toBe(409);
        expect(quote.json().error.code).toBe("generation_confirmation_required");
        const approval = (await db.query("select id from generation_approvals where model=$1 and status='pending'", [model])).rows[0].id;
        await f.approvals.approve({ approvalId: approval, workspaceId: f.workspaceId, userId: f.userId });
        currentQuote = 4;
        expect((await send(payload, approval)).statusCode).toBe(409);
        expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(100);
        expect(await f.jobs.claimJob(pending.id)).toBeNull();
        currentQuote = 2;
        const responses = await Promise.all([send(payload, approval), send(payload, approval)]);
        for (const response of responses) {
          expect([200, 201], response.body).toContain(response.statusCode);
          expect(response.json().job.id).toBe(pending.id);
          expect(response.json().job.stage).toBe("queued");
        }
        expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(98);
        expect((await f.jobs.listJobs(user))).toHaveLength(1);
        expect((await f.credits.getTransactions(f.workspaceId)).filter(tx => tx.job_id === pending.id)).toHaveLength(1);
        expect(await f.jobs.claimJob(pending.id)).not.toBeNull();
        const repeated = await send(payload, approval);
        expect(repeated.statusCode, repeated.body).toBe(200);
        expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(98);
      } finally { await app.close(); await f.app.close(); }
    });
  }

  it("resumes the quoted original job through the public confirm route without creating another job", async () => {
    const f = await fixture();
    const user = { id: f.userId, accessToken: "test", email: "resume@example.test", userMetadata: {} };
    const pending = await f.jobs.createJob(user, { workspaceId: f.workspaceId, jobType: "image_generation",
      payload: f.input.payload, idempotencyKey: randomUUID(), requiresCreditReservation: true });
    const quote = await f.approvals.gate({ ...f.input, context: { reservationJobId: pending.id } });
    if (quote.state !== "confirmation_required") throw new Error("Expected recovery quote");
    try {
      const confirm = () => f.app.inject({ method: "POST", url: `/api/generation-approvals/${quote.request.approvalId}/confirm` });
      const responses = await Promise.all(Array.from({ length: 5 }, confirm));
      for (const response of responses) {
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().data.jobId).toBe(pending.id);
      }
      expect(await f.jobs.listJobs(user)).toHaveLength(1);
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(96.5);
      expect(await f.credits.getTransactions(f.workspaceId)).toHaveLength(1);
      expect(await f.jobs.claimJob(pending.id)).not.toBeNull();
    } finally { await f.app.close(); }
  });

  it("retains a failed reservation and resumes it when confirming again without reopening canceled jobs", async () => {
    const f = await fixture();
    await db.query("update credit_balances set balance=0 where workspace_id=$1", [f.workspaceId]);
    try {
      const failed = await f.confirm();
      expect(failed.statusCode, failed.body).toBe(402);
      const [pending] = await f.jobs.listJobs({ id: f.userId } as never);
      expect(pending).toMatchObject({ status: "queued", stage: "awaiting_credit_reservation", error_code: "credit_reservation_failed" });
      expect(await f.jobs.claimJob(pending!.id)).toBeNull();
      await db.query("update credit_balances set balance=100 where workspace_id=$1", [f.workspaceId]);
      expect((await f.confirm()).json().data.jobId).toBe(pending!.id);
      expect(await f.jobs.getJobAdmin(pending!.id)).toMatchObject({ stage: "queued", error_code: null, error_message: null });
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(96.5);
      const cancellation = await f.app.inject({ method: "POST", url: `/api/jobs/${pending!.id}/cancel` });
      expect(cancellation.statusCode).toBe(200);
      expect((await f.confirm()).json().data.jobId).toBe(pending!.id);
      expect((await f.jobs.getJobAdmin(pending!.id)).status).toBe("canceled");
      expect(await f.jobs.claimJob(pending!.id)).toBeNull();
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(100);
      expect(await f.jobs.listJobs({ id: f.userId } as never)).toHaveLength(1);
    } finally { await f.app.close(); }
  });

  it("separates quotes by full project, request and recovery context", async () => {
    const f = await fixture();
    const contexts = [{ projectId: randomUUID() }, { projectId: randomUUID() }, { requestKey: randomUUID() },
      { requestKey: randomUUID() }, { reservationJobId: randomUUID() }, { reservationJobId: randomUUID() }];
    try {
      const quoted = await Promise.all(contexts.map(context => f.approvals.gate({ ...f.input, context })));
      expect(new Set(quoted.map(quote => quote.state === "confirmation_required" ? quote.request.approvalId : "")).size).toBe(contexts.length);
      const first = quoted[0];
      if (first?.state !== "confirmation_required") throw new Error("Expected quote");
      await f.approvals.approve({ approvalId: first.request.approvalId, workspaceId: f.workspaceId, userId: f.userId });
      await expect(f.approvals.gate({ ...f.input, context: contexts[1]!, approvalId: first.request.approvalId }))
        .rejects.toMatchObject({ code: "generation_approval_invalid" });
      expect(await f.credits.getTransactions(f.workspaceId)).toHaveLength(0);
    } finally { await f.app.close(); }
  });

  it("refuses linking a quote to changed references or another account's job", async () => {
    const f = await fixture(), other = await fixture();
    try {
      await f.approvals.approve({ approvalId: f.approvalId, workspaceId: f.workspaceId, userId: f.userId });
      for (const [owner, params] of [[f, { ...f.input.payload, prompt: "different request" }], [other, f.input.payload]] as const) {
        const job = await owner.jobs.createJob({ id: owner.userId } as never, { workspaceId: owner.workspaceId,
          jobType: "image_generation", payload: params, requiresCreditReservation: true });
        expect(await f.approvals.attachJob(f.approvalId, job.id)).toBeNull();
        expect(await owner.jobs.claimJob(job.id)).toBeNull();
      }
      expect((await db.query("select job_id,consumed_at from generation_approvals where id=$1", [f.approvalId])).rows[0])
        .toEqual({ job_id: null, consumed_at: null });
    } finally { await f.app.close(); await other.app.close(); }
  });

  it("shows a repeated confirm as the same canceled task rather than creating or charging again", async () => {
    const f = await fixture();
    try {
      const jobId = (await f.confirm()).json().data.jobId;
      await f.app.inject({ method: "POST", url: `/api/jobs/${jobId}/cancel` });
      const original = await f.jobs.getJobAdmin(jobId);
      const replayed = await f.jobs.createJob({ id: f.userId } as never, { workspaceId: f.workspaceId, jobType: "image_generation",
        payload: f.input.payload, idempotencyKey: `approval:${f.approvalId}`, requiresCreditReservation: true });
      expect(replayed).toMatchObject({ id: jobId, reused: true, status: "canceled", canceled_at: original.canceled_at });
      expect((await f.confirm()).json().data.jobId).toBe(jobId);
      expect(await f.jobs.claimJob(jobId)).toBeNull();
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(100);
      expect(await f.credits.getTransactions(f.workspaceId)).toHaveLength(2);
    } finally { await f.app.close(); }
  });

  it("does not refund a requeued provider checkpoint or a reset attempt counter", async () => {
    for (const checkpoint of [true, false]) {
      const f = await fixture();
      try {
        const jobId = (await f.confirm()).json().data.jobId;
        await db.query("update background_jobs set status='queued',attempt_count=0,started_at=$2,provider_result=$3::jsonb where id=$1", [jobId, checkpoint ? null : new Date(), checkpoint ? JSON.stringify({ taskId: "provider-accepted", url: "https://example.test/result.mp4" }) : null]);
        const reply = await f.app.inject({ method: "POST", url: `/api/jobs/${jobId}/cancel` });
        expect(reply.statusCode, reply.body).toBe(409);
        expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(96.5);
        expect((await f.credits.getTransactions(f.workspaceId)).filter(row => row.transaction_type === "generation_refund")).toHaveLength(0);
        expect((await f.jobs.getJob({ id: f.userId } as never, jobId)).status).toBe("queued");
      } finally { await f.app.close(); }
    }
  });

  it("keeps completion and cancellation consistent when they race on the same job", async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const f = await fixture();
      try {
        const jobId = (await f.confirm()).json().data.jobId;
        await f.jobs.claimJob(jobId);
        const artifact = { asset_id: randomUUID() };
        const [reply] = await Promise.all([
          f.app.inject({ method: "POST", url: `/api/jobs/${jobId}/cancel` }),
          f.jobs.markSucceeded(jobId, artifact),
        ]);
        expect([200, 409]).toContain(reply.statusCode);
        const saved = await f.jobs.getJobAdmin(jobId);
        expect(saved.status).toBe("succeeded");
        expect(saved.result?.asset_id).toBe(artifact.asset_id);
        if (reply.statusCode === 200) {
          expect(saved.cancel_requested_at).toEqual(expect.any(String));
          expect(saved.result).toMatchObject({ cancellation: { requested: true, outcome: "completed_after_cancel_request" } });
        } else {
          expect(saved.cancel_requested_at).toBeNull();
          expect(saved.result?.cancellation).toBeUndefined();
        }
        expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(96.5);
        expect(await f.credits.getTransactions(f.workspaceId)).toHaveLength(1);
      } finally { await f.app.close(); }
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

  it("stops a historical quote without a pricing snapshot before any credit is deducted", async () => {
    const f = await fixture();
    await db.query("update generation_approvals set billing_pricing=null where id=$1", [f.approvalId]);
    try {
      const response = await f.confirm();
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.message).toContain("价格快照");
      expect((await f.credits.getBalance(f.workspaceId)).balance).toBe(100);
      expect(await f.credits.getTransactions(f.workspaceId)).toHaveLength(0);
      const [job] = await f.jobs.listJobs({ id: f.userId } as never);
      expect(job).toMatchObject({ status: "queued", stage: "awaiting_credit_reservation" });
      expect(await f.jobs.claimJob(job!.id)).toBeNull();
    } finally { await f.app.close(); }
  });
});
