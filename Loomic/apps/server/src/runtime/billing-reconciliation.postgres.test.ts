import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalCreditService } from "../local-db/credit-service.js";
import { createLocalJobService } from "../local-db/job-service.js";
import { reconcileGenerationBilling } from "./billing-reconciliation.js";
import { loadHomeOverview } from "../local-db/home-overview-service.js";
import { loadAdminOverviewCharts } from "../local-db/admin-overview-charts.js";
import { registerJobRoutes } from "../http/jobs.js";
import { createGenerationApprovalService } from "../features/generation/generation-approval-service.js";
import { decideSettlementReview } from "../features/jobs/settlement-review.js";
import { syncGenerationJob } from "../features/jobs/sync-service.js";
import { createLocalJobQueue } from "../queue/local-job-queue.js";
import { cancelUnstartedJob } from "../features/jobs/cancel-unstarted-job.js";
import { recoverCanceledRefunds } from "./canceled-refund-recovery.js";

const databaseUrl = process.env.HELT_TEST_DATABASE_URL;
const schema = `settlement_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let db: Pool;

describe.skipIf(!databaseUrl)("Worker generation settlement with a real ledger", () => {
  beforeAll(async () => {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl!).hostname)) {
      throw new Error("Settlement tests require an isolated loopback PostgreSQL database.");
    }
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema ${schema}`);
    db = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 10 });
    await db.query(await readFile(new URL("../local-db/schema.sql", import.meta.url), "utf8"));
    const migration = await readFile(new URL("../local-db/migrations/20261114000001_generation_settlements.sql", import.meta.url), "utf8");
    await db.query(migration);
    await db.query(migration);
    const pricingMigration = await readFile(new URL("../local-db/migrations/20261114000002_approval_pricing.sql", import.meta.url), "utf8");
    await db.query(pricingMigration);
    await db.query(pricingMigration);
    const reservationPricing = await readFile(new URL("../local-db/migrations/20261114000004_reservation_pricing.sql", import.meta.url), "utf8");
    await db.query(reservationPricing);
    await db.query(reservationPricing);
    const reservationApproval = await readFile(new URL("../local-db/migrations/20261114000007_reservation_approval.sql", import.meta.url), "utf8");
    await db.query(reservationApproval);
    await db.query(reservationApproval);
    await db.query(`create table canvas_workflow_runs(id uuid primary key,goal_id uuid unique,budget_credits numeric(14,4) not null);
      create table canvas_workflow_budget_reservations(approval_id uuid primary key references generation_approvals(id),
        run_id uuid not null references canvas_workflow_runs(id),credits numeric(14,4) not null)`);
  });

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop schema if exists ${schema} cascade`);
      await admin.end();
    }
  });

  async function fixture(reserve = 3, model = "MiniMax-H3") {
    const userId = randomUUID(), workspaceId = randomUUID();
    await db.query("insert into app_users(id,email) values($1,$2)", [userId, `${userId}@example.test`]);
    await db.query("insert into workspaces(id,owner_user_id,name) values($1,$2,'Settlement regression')", [workspaceId, userId]);
    await db.query("insert into credit_balances(workspace_id,balance) values($1,100)", [workspaceId]);
    if (model.startsWith("custom-auto-")) {
      const provider = randomUUID();
      await db.query(`insert into provider_configs(id,workspace_id,label,base_url,key_ciphertext,key_last4,health_status)
        values($1,$2,'fixture','https://provider.invalid','fixture','test','healthy')`, [provider, workspaceId]);
      await db.query(`insert into provider_models(provider_id,model_id,display_name,media_type,billing_unit,price_credits)
        values($1,$2,'fixture','video','per_second',0.3)`, [provider, model]);
    }
    const credits = createLocalCreditService(db), jobs = createLocalJobService(db);
    const user = { id: userId, email: `${userId}@example.test`, accessToken: "test", userMetadata: {} };
    const job = await jobs.createJob(user, { workspaceId, jobType: "video_generation", payload: { model, duration: 10 } });
    const debit = await credits.deductCredits(workspaceId, userId, reserve, job.id, "Confirmed generation");
    await jobs.setCreditsInfo(job.id, reserve, debit);
    await db.query("update background_jobs set status='running',started_at=now(),attempt_count=1 where id=$1", [job.id]);
    const ctx = { jobService: jobs, localDb: db, getAdminClient: () => { throw new Error("Local ledger required"); } };
    const output = { asset_id: randomUUID(), duration_seconds: 12, duration_source: "provider" };
    const settle = (duration = 12) => reconcileGenerationBilling(job.id, { ...output, duration_seconds: duration }, ctx, "[settlement-test]");
    const ledger = () => credits.getTransactions(workspaceId);
    const balance = async () => (await credits.getBalance(workspaceId)).balance;
    return { job, jobs, user, userId, workspaceId, credits, debit, settle, ledger, balance, output };
  }

  async function pendingReview() {
    const f = await fixture();
    const approvals = createGenerationApprovalService(db);
    const quote = await approvals.gate({ workspaceId: f.workspaceId, userId: f.userId, jobType: "video_generation",
      model: "MiniMax-H3", payload: { model: "MiniMax-H3", duration: 10 }, estimatedCredits: 3, forceConfirmation: true });
    if (quote.state !== "confirmation_required") throw new Error("Expected quote");
    await approvals.approve({ approvalId: quote.request.approvalId, workspaceId: f.workspaceId, userId: f.userId });
    await approvals.attachJob(quote.request.approvalId, f.job.id);
    await expect(f.settle()).rejects.toMatchObject({ code: "generation_settlement_review_required" });
    await db.query("update background_jobs set status='sync_failed' where id=$1", [f.job.id]);
    const review = (await f.jobs.getJobAdmin(f.job.id)).settlement_review;
    if (!review) throw new Error("Expected persisted settlement review");
    return { ...f, review };
  }

  it("charges the difference even when the initial debit already exists", async () => {
    const f = await fixture();
    await f.settle();
    expect(await f.balance()).toBe(96.4);
    expect((await f.ledger()).map(tx => [tx.transaction_type, tx.amount])).toEqual(expect.arrayContaining([
      ["generation_deduct", -3], ["generation_adjustment", -0.6],
    ]));
    const saved = (await db.query("select credits_cost,credits_transaction_id from background_jobs where id=$1", [f.job.id])).rows[0];
    expect(Number(saved.credits_cost)).toBe(3.6);
    expect(saved.credits_transaction_id).toBe(f.debit);
    expect((await f.credits.getBalance(f.workspaceId)).totalSpent).toBe(3.6);
    expect((await loadHomeOverview(db, f.workspaceId, 14)).daily.at(-1)?.creditsSpent).toBe(3.6);
    expect((await loadAdminOverviewCharts(db, 14, f.workspaceId)).daily.at(-1)?.creditsSpent).toBe(3.6);
    const job = await f.jobs.getJobAdmin(f.job.id);
    expect(job.billing_receipt).toMatchObject({ reservedCredits: 3, settledCredits: 3.6, balanceDelta: -0.6, reservationTransactionId: f.debit });
    await f.jobs.setCreditsInfo(f.job.id, 3, f.debit);
    expect(Number((await db.query("select credits_cost from background_jobs where id=$1", [f.job.id])).rows[0].credits_cost)).toBe(3.6);
  });

  it("keeps an automatic paid job unclaimable until its reservation receipt is linked", async () => {
    const f = await fixture();
    const input = { workspaceId: f.workspaceId, jobType: "video_generation" as const,
      payload: { model: "MiniMax-H3", duration: 10 }, idempotencyKey: randomUUID(), requiresCreditReservation: true };
    const queued = await f.jobs.createJob(f.user, input);
    const queue = createLocalJobQueue(db);
    try {
      expect(queued.stage).toBe("awaiting_credit_reservation");
      expect(await f.jobs.claimJob(queued.id)).toBeNull();
      expect((await queue.read("video_generation_jobs", 60, 100)).some(message => message.message.job_id === queued.id)).toBe(false);
      const retry = await f.jobs.createJob(f.user, input);
      expect(retry).toMatchObject({ id: queued.id, reused: true, stage: "awaiting_credit_reservation" });
      const charge = await f.credits.deductCredits(f.workspaceId, f.userId, 3, queued.id, "Paid queue regression");
      expect(await f.jobs.getJobAdmin(queued.id)).toMatchObject({ stage: "queued",
        billing_pricing: { billingUnit: "per_second", creditCost: 0.3 } });
      expect((await db.query("select credits_transaction_id from background_jobs where id=$1", [queued.id])).rows[0].credits_transaction_id).toBe(charge);
      await f.jobs.setCreditsInfo(queued.id, 3, charge);
      expect((await queue.read("video_generation_jobs", 60, 100)).some(message => message.message.job_id === queued.id)).toBe(true);
      const claims = await Promise.all(Array.from({ length: 5 }, () => f.jobs.claimJob(queued.id)));
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect((await f.jobs.getJobAdmin(queued.id)).billing_pricing).toEqual({ billingUnit: "per_second", creditCost: 0.3 });
      expect((await f.ledger()).filter(tx => tx.job_id === queued.id)).toHaveLength(1);
    } finally { await queue.shutdown(); }
  });

  it("rolls back the initial charge if reservation linkage fails", async () => {
    const f = await fixture();
    const queued = await f.jobs.createJob(f.user, { workspaceId: f.workspaceId, jobType: "video_generation",
      payload: { model: "MiniMax-H3", duration: 10 }, requiresCreditReservation: true });
    await db.query(`create function reject_reservation() returns trigger language plpgsql as $$
      begin if new.id='${queued.id}' and new.credits_transaction_id is not null then
        raise exception 'injected reservation failure'; end if; return new; end $$;
      create trigger reject_reservation before update on background_jobs for each row execute function reject_reservation()`);
    try {
      await expect(f.credits.deductCredits(f.workspaceId, f.userId, 3, queued.id)).rejects.toThrow();
      expect(await f.balance()).toBe(97);
      expect((await f.ledger()).filter(tx => tx.job_id === queued.id)).toHaveLength(0);
      expect(await f.jobs.getJobAdmin(queued.id)).toMatchObject({ stage: "awaiting_credit_reservation" });
      expect((await db.query("select credits_transaction_id from background_jobs where id=$1", [queued.id])).rows[0].credits_transaction_id).toBeNull();
      expect(await f.jobs.claimJob(queued.id)).toBeNull();
    } finally { await db.query("drop trigger reject_reservation on background_jobs; drop function reject_reservation()"); }
    await f.credits.deductCredits(f.workspaceId, f.userId, 3, queued.id);
    expect(await f.balance()).toBe(94);
    expect(await f.jobs.claimJob(queued.id)).not.toBeNull();
  });

  it("rejects a charge after cancellation and serializes concurrent charge and cancellation", async () => {
    const f = await fixture();
    const input = { workspaceId: f.workspaceId, jobType: "video_generation" as const,
      payload: { model: "MiniMax-H3", duration: 10 }, requiresCreditReservation: true };
    const canceled = await f.jobs.createJob(f.user, input);
    await cancelUnstartedJob(db, canceled.id, f.userId);
    await expect(f.credits.deductCredits(f.workspaceId, f.userId, 3, canceled.id)).rejects.toMatchObject({ statusCode: 409 });
    expect(await f.balance()).toBe(97);
    for (let attempt = 0; attempt < 5; attempt++) {
      const queued = await f.jobs.createJob(f.user, input);
      const [charge, cancellation] = await Promise.allSettled([
        f.credits.deductCredits(f.workspaceId, f.userId, 3, queued.id),
        cancelUnstartedJob(db, queued.id, f.userId),
      ]);
      if (cancellation.status !== "fulfilled") throw cancellation.reason;
      expect(cancellation.value.amount).toBe(charge.status === "fulfilled" ? 3 : 0);
      expect(await f.balance()).toBe(97);
      expect((await f.ledger()).filter(tx => tx.job_id === queued.id && tx.transaction_type === "generation_refund"))
        .toHaveLength(charge.status === "fulfilled" ? 1 : 0);
      expect(await f.jobs.claimJob(queued.id)).toBeNull();
    }
  });

  it("does not admit a paid job with another job's debit receipt", async () => {
    const f = await fixture();
    const queued = await f.jobs.createJob(f.user, { workspaceId: f.workspaceId, jobType: "video_generation",
      payload: { model: "MiniMax-H3", duration: 10 }, requiresCreditReservation: true });
    await db.query("update background_jobs set credits_cost=3,credits_transaction_id=$2 where id=$1", [queued.id, f.debit]);
    expect(await f.jobs.claimJob(queued.id)).toBeNull();
    await db.query("update background_jobs set status='canceled' where id=$1", [queued.id]);
  });

  it("blocks a refunded debit even if another path resets the job to queued", async () => {
    for (const required of [true, false]) {
      const f = await fixture();
      await db.query("update background_jobs set billing_required=$2,status='queued',started_at=null,attempt_count=0 where id=$1", [f.job.id, required]);
      await cancelUnstartedJob(db, f.job.id, f.userId);
      await db.query("update background_jobs set status='queued' where id=$1", [f.job.id]);
      const queue = createLocalJobQueue(db);
      try {
        expect(await f.jobs.claimJob(f.job.id)).toBeNull();
        expect((await queue.read("video_generation_jobs", 60, 100)).some(message => message.message.job_id === f.job.id)).toBe(false);
        expect(await f.balance()).toBe(100);
      } finally { await queue.shutdown(); }
    }
  });

  it("automatically refunds interrupted cancellations once and quarantines inconsistent ledgers", async () => {
    const valid = await fixture(), corrupt = await fixture(), started = await fixture();
    await db.query("update background_jobs set status='canceled',started_at=null,attempt_count=0 where id=any($1::uuid[])", [[valid.job.id, corrupt.job.id]]);
    await db.query("update background_jobs set credits_cost=99 where id=$1", [corrupt.job.id]);
    await db.query("update background_jobs set status='canceled' where id=$1", [started.job.id]);
    const batches = await Promise.all([recoverCanceledRefunds(db), recoverCanceledRefunds(db)]);
    expect(batches.some(batch => batch.refunded.includes(valid.job.id))).toBe(true);
    expect(await valid.balance()).toBe(100);
    expect((await valid.ledger()).filter(tx => tx.transaction_type === 'generation_refund')).toHaveLength(1);
    expect(await corrupt.balance()).toBe(97);
    expect((await corrupt.jobs.getJobAdmin(corrupt.job.id)).error_code).toBe('cancel_refund_review_required');
    expect(await started.balance()).toBe(97);
    const again = await recoverCanceledRefunds(db);
    expect(again.refunded).not.toContain(valid.job.id);
    expect(again.review).not.toContain(corrupt.job.id);
    expect(again.refunded).not.toContain(started.job.id);
  });

  it("commits unstarted cancellation and its refund together, including interrupted legacy cancellations", async () => {
    for (const status of ["queued", "canceled"]) {
      const f = await fixture();
      await db.query("update background_jobs set status=$2,started_at=null,attempt_count=0 where id=$1", [f.job.id, status]);
      await Promise.all(Array.from({ length: 5 }, () => cancelUnstartedJob(db, f.job.id, f.userId)));
      expect(await f.balance()).toBe(100);
      expect((await f.ledger()).filter(tx => tx.transaction_type === "generation_refund")).toHaveLength(1);
      expect((await f.jobs.getJobAdmin(f.job.id)).status).toBe("canceled");
    }
  });

  it("does not commit cancellation when writing its refund fails", async () => {
    const f = await fixture();
    await db.query("update background_jobs set status='queued',started_at=null,attempt_count=0 where id=$1", [f.job.id]);
    await db.query(`create function reject_cancel_refund() returns trigger language plpgsql as $$
      begin if new.job_id='${f.job.id}' and new.transaction_type='generation_refund' then
        raise exception 'injected cancellation refund failure'; end if; return new; end $$;
      create trigger reject_cancel_refund before insert on credit_transactions for each row execute function reject_cancel_refund()`);
    try {
      await expect(cancelUnstartedJob(db, f.job.id, f.userId)).rejects.toThrow();
      expect(await f.balance()).toBe(97);
      expect(await f.ledger()).toHaveLength(1);
      expect((await f.jobs.getJobAdmin(f.job.id)).status).toBe("queued");
    } finally { await db.query("drop trigger reject_cancel_refund on credit_transactions; drop function reject_cancel_refund()"); }
    await cancelUnstartedJob(db, f.job.id, f.userId);
    expect(await f.balance()).toBe(100);
  });

  it("does not refund settled work whose queue status and attempt count were reset", async () => {
    const f = await fixture();
    await f.settle(10);
    await db.query("update background_jobs set status='queued',started_at=null,attempt_count=0,provider_result=null where id=$1", [f.job.id]);
    await expect(cancelUnstartedJob(db, f.job.id, f.userId)).rejects.toMatchObject({ statusCode: 409 });
    expect(await f.balance()).toBe(97);
    expect(await f.ledger()).toHaveLength(1);
  });

  it("rolls back a refund if committing the cancellation state fails", async () => {
    const f = await fixture();
    await db.query("update background_jobs set status='queued',started_at=null,attempt_count=0 where id=$1", [f.job.id]);
    await db.query(`create function reject_cancel_state() returns trigger language plpgsql as $$
      begin if new.id='${f.job.id}' and new.status='canceled' then
        raise exception 'injected cancellation state failure'; end if; return new; end $$;
      create trigger reject_cancel_state before update on background_jobs for each row execute function reject_cancel_state()`);
    try {
      await expect(cancelUnstartedJob(db, f.job.id, f.userId)).rejects.toThrow();
      expect(await f.balance()).toBe(97);
      expect(await f.ledger()).toHaveLength(1);
      expect((await f.jobs.getJobAdmin(f.job.id)).status).toBe("queued");
    } finally { await db.query("drop trigger reject_cancel_state on background_jobs; drop function reject_cancel_state()"); }
  });

  it("does not run a legacy unlinked debit and repairs it without charging again", async () => {
    const f = await fixture();
    const queued = await f.jobs.createJob(f.user, { workspaceId: f.workspaceId, jobType: "video_generation",
      payload: { model: "MiniMax-H3", duration: 10 }, requiresCreditReservation: true });
    await db.query("update credit_balances set balance=balance-3 where workspace_id=$1", [f.workspaceId]);
    const debit = (await db.query(`insert into credit_transactions(workspace_id,user_id,transaction_type,amount,balance_after,job_id)
      values($1,$2,'generation_deduct',-3,94,$3) returning id`, [f.workspaceId, f.userId, queued.id])).rows[0].id;
    expect(await f.jobs.claimJob(queued.id)).toBeNull();
    const queue = createLocalJobQueue(db);
    try {
      expect((await queue.read("video_generation_jobs", 60, 100)).some(message => message.message.job_id === queued.id)).toBe(false);
      expect(await f.credits.deductCredits(f.workspaceId, f.userId, 3, queued.id)).toBe(debit);
      expect(await f.balance()).toBe(94);
      expect((await f.ledger()).filter(tx => tx.job_id === queued.id)).toHaveLength(1);
      expect(await f.jobs.claimJob(queued.id)).not.toBeNull();
    } finally { await queue.shutdown(); }
  });

  it("replays the original debit after settlement without overwriting it or accepting a new quote", async () => {
    const f = await fixture();
    const receipt = await f.settle(5);
    expect(await f.credits.deductCredits(f.workspaceId, f.userId, 3, f.job.id)).toBe(f.debit);
    await expect(f.credits.deductCredits(f.workspaceId, f.userId, 30, f.job.id)).rejects.toMatchObject({ statusCode: 409 });
    expect(await f.balance()).toBe(98.5);
    expect(await f.ledger()).toHaveLength(2);
    expect((await f.jobs.getJobAdmin(f.job.id)).billing_receipt).toEqual(receipt);
    expect(Number((await db.query("select credits_cost from background_jobs where id=$1", [f.job.id])).rows[0].credits_cost)).toBe(1.5);
  });

  it("settles concurrent deliveries once and survives a lost acknowledgement", async () => {
    const f = await fixture();
    await Promise.all(Array.from({ length: 6 }, () => f.settle()));
    await f.settle();
    expect(await f.balance()).toBe(96.4);
    expect(await f.ledger()).toHaveLength(2);
  });

  it("keeps a partial settlement refund separate from a later final refund", async () => {
    const f = await fixture();
    await f.settle(5);
    expect(await f.balance()).toBe(98.5);
    expect((await f.credits.getBalance(f.workspaceId)).totalSpent).toBe(1.5);
    await f.credits.refundCredits(f.workspaceId, f.userId, 1.5, f.job.id, "Verified final refund");
    expect(await f.balance()).toBe(100);
    expect(await f.ledger()).toHaveLength(3);
    expect((await f.credits.getBalance(f.workspaceId)).totalSpent).toBe(0);
  });

  it("rolls back the balance and ledger if saving the job cost fails", async () => {
    const f = await fixture();
    await db.query(`create function reject_settlement() returns trigger language plpgsql as $$
      begin if new.id='${f.job.id}' and new.credits_cost<>old.credits_cost then
        raise exception 'injected settlement write failure'; end if; return new; end $$;
      create trigger reject_settlement before update on background_jobs for each row execute function reject_settlement()`);
    try {
      await expect(f.settle(5)).rejects.toThrow();
      expect(await f.balance()).toBe(97);
      expect(await f.ledger()).toHaveLength(1);
      const saved = (await db.query("select credits_cost from background_jobs where id=$1", [f.job.id])).rows[0];
      expect(Number(saved.credits_cost)).toBe(3);
    } finally {
      await db.query("drop trigger reject_settlement on background_jobs; drop function reject_settlement()");
    }
    await f.settle(5);
    expect(await f.balance()).toBe(98.5);
  });

  it("records a zero-difference receipt without creating a zero-value transaction", async () => {
    const f = await fixture();
    const receipt = await f.settle(10);
    expect(receipt).toMatchObject({ reservedCredits: 3, settledCredits: 3, balanceDelta: 0, adjustmentTransactionId: null });
    expect(await f.settle(10)).toEqual(receipt);
    expect(await f.ledger()).toHaveLength(1);
  });

  it("freezes automatic reservation pricing before a custom provider changes its rates", async () => {
    const model = `custom-auto-${randomUUID()}`;
    const f = await fixture(3, model);
    expect((await f.jobs.getJobAdmin(f.job.id)).billing_pricing).toEqual({ billingUnit: "per_second", creditCost: 0.3 });
    await db.query("update provider_models set price_credits=10 where model_id=$1", [model]);
    await f.jobs.setCreditsInfo(f.job.id, 3, f.debit);
    await expect(f.jobs.setCreditsInfo(f.job.id, 100, f.debit)).rejects.toThrow("不能覆盖原金额");
    const receipt = await f.settle(5);
    expect(receipt).toMatchObject({ settledCredits: 1.5, basis: { model, creditsPerSecond: 0.3 } });
    expect(await f.balance()).toBe(98.5);
    await expect(db.query("update background_jobs set billing_pricing='{}'::jsonb where id=$1", [f.job.id]))
      .rejects.toThrow("reservation_pricing_is_immutable");
  });

  it("freezes the quote that actually funded a retried reservation instead of an older failed quote", async () => {
    const f = await fixture(3, `custom-auto-${randomUUID()}`);
    const model = f.job.payload.model as string;
    const job = await f.jobs.createJob(f.user, { workspaceId: f.workspaceId, jobType: "video_generation",
      payload: { model, duration: 10 }, requiresCreditReservation: true });
    const approvals = createGenerationApprovalService(db);
    const quotes: string[] = [];
    for (const amount of [3, 6]) {
      const quote = await approvals.gate({ workspaceId: f.workspaceId, userId: f.userId, jobType: "video_generation",
        model, payload: job.payload, estimatedCredits: amount, forceConfirmation: true, context: { reservationJobId: job.id } });
      if (quote.state !== "confirmation_required") throw new Error("Expected explicit quote");
      quotes.push(quote.request.approvalId);
      await approvals.approve({ approvalId: quote.request.approvalId, workspaceId: f.workspaceId, userId: f.userId });
      expect(await approvals.attachJob(quote.request.approvalId, job.id)).toBe(job.id);
    }
    await f.credits.deductCredits(f.workspaceId, f.userId, 6, job.id);
    expect((await f.jobs.getJobAdmin(job.id)).billing_pricing).toEqual({ billingUnit: "per_second", creditCost: 0.6 });
    await db.query("update background_jobs set status='running',started_at=now(),attempt_count=1 where id=$1", [job.id]);
    const receipt = await reconcileGenerationBilling(job.id, { duration_seconds: 5, duration_source: "provider" },
      { jobService: f.jobs, localDb: db }, "[quote-recovery]");
    expect(receipt).toMatchObject({ reservedCredits: 6, settledCredits: 3, balanceDelta: 3, basis: { creditsPerSecond: 0.6 } });
    expect(await f.balance()).toBe(94);
    expect(await approvals.attachJob(quotes[0]!, job.id)).toBeNull();
    await expect(db.query("update background_jobs set billing_approval_id=$2 where id=$1", [job.id, quotes[0]]))
      .rejects.toThrow("reservation_approval_is_immutable");
  });

  it("rolls back a competing debit when the task is bound to a different confirmed amount", async () => {
    const f = await fixture();
    const job = await f.jobs.createJob(f.user, { workspaceId: f.workspaceId, jobType: "video_generation",
      payload: { model: "MiniMax-H3", duration: 10 }, requiresCreditReservation: true });
    const approvals = createGenerationApprovalService(db);
    const quote = await approvals.gate({ workspaceId: f.workspaceId, userId: f.userId, jobType: "video_generation",
      model: "MiniMax-H3", payload: job.payload, estimatedCredits: 6, forceConfirmation: true });
    if (quote.state !== "confirmation_required") throw new Error("Expected quote");
    await approvals.approve({ approvalId: quote.request.approvalId, workspaceId: f.workspaceId, userId: f.userId });
    await approvals.attachJob(quote.request.approvalId, job.id);
    await expect(f.credits.deductCredits(f.workspaceId, f.userId, 3, job.id)).rejects.toThrow();
    expect(await f.balance()).toBe(97);
    expect((await f.ledger()).filter(tx => tx.job_id === job.id)).toHaveLength(0);
    expect(await f.jobs.claimJob(job.id)).toBeNull();
    await f.credits.deductCredits(f.workspaceId, f.userId, 6, job.id);
    expect(await f.balance()).toBe(91);
  });

  it("rejects a superseded approval even when both quotes reserve the same amount", async () => {
    const f = await fixture();
    const job = await f.jobs.createJob(f.user, { workspaceId: f.workspaceId, jobType: "video_generation",
      payload: { model: "MiniMax-H3", duration: 10 }, requiresCreditReservation: true });
    const approvals = createGenerationApprovalService(db);
    const quoteIds: string[] = [];
    for (const requestKey of ["first-quote", "replacement-quote"]) {
      const quote = await approvals.gate({ workspaceId: f.workspaceId, userId: f.userId, jobType: "video_generation",
        model: "MiniMax-H3", payload: job.payload, estimatedCredits: 3, forceConfirmation: true,
        context: { reservationJobId: job.id, websiteCaptureTaskId: requestKey } });
      if (quote.state !== "confirmation_required") throw new Error("Expected explicit quote");
      quoteIds.push(quote.request.approvalId);
      await approvals.approve({ approvalId: quote.request.approvalId, workspaceId: f.workspaceId, userId: f.userId });
      expect(await approvals.attachJob(quote.request.approvalId, job.id)).toBe(job.id);
    }
    await expect(f.credits.deductCredits(f.workspaceId, f.userId, 3, job.id, "Superseded quote", quoteIds[0]!))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await f.balance()).toBe(97);
    expect((await f.ledger()).filter(tx => tx.job_id === job.id)).toHaveLength(0);
    await f.credits.deductCredits(f.workspaceId, f.userId, 3, job.id, "Current quote", quoteIds[1]!);
    expect(await f.balance()).toBe(94);
    expect((await f.ledger()).filter(tx => tx.job_id === job.id)).toHaveLength(1);
  });

  it("uses the configured billing unit instead of a conflicting catalog default", async () => {
    const f = await fixture();
    const provider = randomUUID();
    await db.query(`insert into provider_configs(id,workspace_id,label,base_url,key_ciphertext,key_last4,health_status)
      values($1,$2,'fixture','https://provider.invalid','fixture','test','healthy')`, [provider, f.workspaceId]);
    await db.query(`insert into provider_models(provider_id,model_id,display_name,media_type,billing_unit,price_credits)
      values($1,'MiniMax-H3','fixture','video','per_generation',2)`, [provider]);
    try {
    const job = await f.jobs.createJob(f.user, { workspaceId: f.workspaceId, jobType: "video_generation", payload: { model: "MiniMax-H3", duration: 10 } });
    const debit = await f.credits.deductCredits(f.workspaceId, f.userId, 2, job.id, "Configured fixed price");
    await f.jobs.setCreditsInfo(job.id, 2, debit);
    expect((await f.jobs.getJobAdmin(job.id)).billing_pricing).toEqual({ billingUnit: "per_generation", creditCost: 2 });
    const approvals = createGenerationApprovalService(db);
    const quote = await approvals.gate({ workspaceId: f.workspaceId, userId: f.userId, jobType: "video_generation",
      model: "MiniMax-H3", payload: { duration: 10 }, estimatedCredits: 2, forceConfirmation: true });
    if (quote.state !== "confirmation_required") throw new Error("Expected quote");
    const saved = (await db.query("select billing_pricing from generation_approvals where id=$1", [quote.request.approvalId])).rows[0];
    expect(saved.billing_pricing).toEqual({ billingUnit: "per_generation", creditCost: 2 });
    } finally { await db.query("delete from provider_configs where id=$1", [provider]); }
  });

  it("rejects changed usage after settlement without changing the original receipt", async () => {
    const f = await fixture();
    const receipt = await f.settle(12);
    await expect(f.settle(13)).rejects.toMatchObject({ code: "generation_settlement_review_required" });
    expect((await f.jobs.getJobAdmin(f.job.id)).billing_receipt).toEqual(receipt);
    expect(await f.balance()).toBe(96.4);
    expect(await f.ledger()).toHaveLength(2);
  });

  it("keeps the reservation intact when additional credits are unavailable", async () => {
    const f = await fixture();
    await db.query("update credit_balances set balance=0.1 where workspace_id=$1", [f.workspaceId]);
    await expect(f.settle()).rejects.toMatchObject({ code: "insufficient_credits" });
    expect(await f.balance()).toBe(0.1);
    expect(await f.ledger()).toHaveLength(1);
    expect((await f.jobs.getJobAdmin(f.job.id)).billing_receipt).toBeNull();
  });

  it("refuses to settle a refunded or inconsistent reservation", async () => {
    const f = await fixture();
    await f.credits.refundCredits(f.workspaceId, f.userId, 3, f.job.id, "Verified refund");
    await expect(f.settle()).rejects.toMatchObject({ code: "generation_settlement_review_required" });
    expect(await f.balance()).toBe(100);
    expect((await f.jobs.getJobAdmin(f.job.id)).billing_receipt).toBeNull();
  });

  it("rejects another workspace's charge for an existing job", async () => {
    const first = await fixture(), second = await fixture();
    await expect(second.credits.deductCredits(second.workspaceId, second.userId, 2, first.job.id, "Scoped debit"))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(await second.balance()).toBe(97);
    expect(await second.ledger()).toHaveLength(1);
    expect(await first.balance()).toBe(97);
  });

  it("returns the persisted settlement through the job and timeline HTTP routes", async () => {
    const f = await fixture();
    const receipt = await f.settle();
    const app = Fastify();
    await registerJobRoutes(app, { localDb: db, jobService: f.jobs, creditService: f.credits,
      auth: { authenticate: async req => req.headers.authorization === "test" ? f.user : null },
      viewerService: { ensureViewer: async () => ({ workspace: { id: f.workspaceId } }) } as never,
    });
    try {
      const url = `/api/jobs/${f.job.id}`;
      expect((await app.inject(url)).statusCode).toBe(401);
      const detail = await app.inject({ url, headers: { authorization: "test" } });
      expect(detail.statusCode, detail.body).toBe(200);
      expect(detail.json().job.billing_receipt).toEqual(receipt);
      const timeline = await app.inject({ url: `${url}/timeline`, headers: { authorization: "test" } });
      expect(timeline.statusCode, timeline.body).toBe(200);
      expect(timeline.json().events).toContainEqual(expect.objectContaining({ key: "settlement", status: "done",
        id: receipt!.adjustmentTransactionId, detail: "预扣 3 积分，结算 3.6 积分；补扣差额 0.6。",
      }));
    } finally { await app.close(); }
  });

  it("uses the approved rate after the provider price changes and refuses snapshot mutation", async () => {
    const f = await fixture();
    const model = `custom-${randomUUID()}`;
    const providerId = randomUUID();
    await db.query(`insert into provider_configs(id,workspace_id,label,base_url,key_ciphertext,key_last4,health_status)
      values($1,$2,'test','https://provider.invalid','test','test','healthy')`, [providerId, f.workspaceId]);
    await db.query(`insert into provider_models(provider_id,model_id,display_name,media_type,billing_unit,price_credits)
      values($1,$2,'test','video','per_second',0.3)`, [providerId, model]);
    await db.query("update background_jobs set payload=jsonb_set(payload,'{model}',to_jsonb($2::text)) || '{\"prompt\":\"test\"}'::jsonb where id=$1", [f.job.id, model]);
    const approvals = createGenerationApprovalService(db);
    const quote = await approvals.gate({ workspaceId: f.workspaceId, userId: f.userId, jobType: "video_generation",
      model, payload: { model, duration: 10, prompt: "test" }, estimatedCredits: 3, forceConfirmation: true });
    if (quote.state !== "confirmation_required") throw new Error("Expected explicit quote");
    await approvals.approve({ approvalId: quote.request.approvalId, workspaceId: f.workspaceId, userId: f.userId });
    await approvals.attachJob(quote.request.approvalId, f.job.id);
    await db.query("update provider_models set price_credits=9 where provider_id=$1", [providerId]);
    await expect(f.settle()).rejects.toMatchObject({ code: "generation_settlement_review_required" });
    expect(await f.balance()).toBe(97);
    expect(await f.ledger()).toHaveLength(1);
    const receipt = await f.settle(5);
    expect(receipt).toMatchObject({ settledCredits: 1.5, basis: { model, creditsPerSecond: 0.3 } });
    expect(await f.balance()).toBe(98.5);
    await expect(db.query("update generation_approvals set billing_pricing='{}'::jsonb where id=$1", [quote.request.approvalId]))
      .rejects.toThrow("approval_pricing_is_immutable");
    expect(await f.settle(5)).toEqual(receipt);
  });

  it("requires review instead of repricing a historical approval without a snapshot", async () => {
    const f = await fixture();
    await db.query(`insert into generation_approvals(workspace_id,user_id,job_type,model,payload,payload_fingerprint,
      estimated_credits,expires_at,status,consumed_at,job_id)
      values($1,$2,'video_generation','MiniMax-H3','{}','legacy',3,now()+interval '1 hour','approved',now(),$3)`,
      [f.workspaceId, f.userId, f.job.id]);
    await expect(f.settle()).rejects.toMatchObject({ code: "generation_settlement_review_required" });
    expect(await f.balance()).toBe(97);
    expect(await f.ledger()).toHaveLength(1);
  });

  it("requires an explicit decision then resumes the existing artifact without another generation", async () => {
    const f = await pendingReview();
    expect(f.review).toMatchObject({ status: "pending", additionalCredits: 0.6 });
    expect(await f.balance()).toBe(97);
    expect(await syncGenerationJob(db, {} as never, f.job.id, { force: true })).toEqual({ state: "in_progress" });
    expect((await f.jobs.getJobAdmin(f.job.id)).status).toBe("sync_failed");
    await Promise.all(Array.from({ length: 5 }, () => decideSettlementReview(db, f.job.id, f.userId, f.review.id, "approve")));
    expect(await f.balance()).toBe(96.4);
    expect(await f.ledger()).toHaveLength(2);
    const job = await f.jobs.getJobAdmin(f.job.id);
    expect(job).toMatchObject({ status: "sync_pending", settlement_review: { status: "consumed" }, result: f.output });
    await syncGenerationJob(db, {} as never, f.job.id);
    expect((await f.jobs.getJobAdmin(f.job.id)).status).toBe("succeeded");
    expect((await f.jobs.listJobs(f.user))).toHaveLength(1);
  });

  it("rejects extra charges without changing the ledger or silently reopening approval", async () => {
    const f = await pendingReview();
    await decideSettlementReview(db, f.job.id, f.userId, f.review.id, "reject");
    await expect(f.settle()).rejects.toThrow("已拒绝额外费用");
    expect(await f.balance()).toBe(97);
    expect(await f.ledger()).toHaveLength(1);
    expect((await f.jobs.getJobAdmin(f.job.id)).settlement_review?.status).toBe("rejected");
    expect(await syncGenerationJob(db, {} as never, f.job.id, { force: true })).toEqual({ state: "in_progress" });
  });

  it("preserves the consumed quote when its expired confirmation is retried", async () => {
    const f = await pendingReview();
    const approvals = createGenerationApprovalService(db);
    const approvalId = (await db.query("select billing_approval_id from background_jobs where id=$1", [f.job.id])).rows[0].billing_approval_id;
    await db.query("update generation_approvals set expires_at=now()-interval '1 minute' where id=$1", [approvalId]);

    await expect(approvals.gate({ workspaceId: f.workspaceId, userId: f.userId, jobType: "video_generation",
      model: "MiniMax-H3", payload: f.job.payload, estimatedCredits: 3, approvalId }))
      .rejects.toMatchObject({ code: "generation_approval_expired" });
    expect((await db.query("select status from generation_approvals where id=$1", [approvalId])).rows[0].status).toBe("approved");
    await expect(f.settle()).rejects.toMatchObject({ code: "generation_settlement_review_required" });
    expect(await f.balance()).toBe(97);
    expect(await f.ledger()).toHaveLength(1);
  });

  it("does not settle automatically when a bound approval is no longer valid", async () => {
    const f = await pendingReview();
    await db.query("update generation_approvals set status='expired' where job_id=$1", [f.job.id]);

    await expect(f.settle()).rejects.toMatchObject({ code: "generation_settlement_review_required" });
    await expect(decideSettlementReview(db, f.job.id, f.userId, f.review.id, "approve"))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await f.balance()).toBe(97);
    expect(await f.ledger()).toHaveLength(1);
    expect((await f.jobs.getJobAdmin(f.job.id)).settlement_review?.status).toBe("pending");
  });

  it("rejects another account and stale review IDs before recording a decision", async () => {
    const f = await pendingReview();
    await expect(decideSettlementReview(db, f.job.id, randomUUID(), f.review.id, "approve")).rejects.toMatchObject({ statusCode: 404 });
    await expect(decideSettlementReview(db, f.job.id, f.userId, randomUUID(), "approve")).rejects.toMatchObject({ statusCode: 409 });
    expect(await f.balance()).toBe(97);
    expect((await f.jobs.getJobAdmin(f.job.id)).settlement_review?.status).toBe("pending");
  });

  it("accepts an owner HTTP decision while rejecting missing auth and stale review IDs", async () => {
    const f = await pendingReview();
    const app = Fastify();
    await registerJobRoutes(app, { localDb: db, jobService: f.jobs, creditService: f.credits,
      auth: { authenticate: async req => req.headers.authorization === "test" ? f.user : null },
      viewerService: {} as never });
    try {
      const url = `/api/jobs/${f.job.id}/settlement-review`;
      expect((await app.inject({ method: "POST", url, payload: { reviewId: f.review.id, decision: "approve" } })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url, headers: { authorization: "test" }, payload: { reviewId: randomUUID(), decision: "approve" } })).statusCode).toBe(409);
      const reply = await app.inject({ method: "POST", url, headers: { authorization: "test" }, payload: { reviewId: f.review.id, decision: "approve" } });
      expect(reply.statusCode, reply.body).toBe(200);
      expect(reply.json().job).toMatchObject({ status: "sync_pending", settlement_review: { status: "consumed" } });
      expect(await f.balance()).toBe(96.4);
    } finally { await app.close(); }
  });

  it("blocks extra confirmation until the workflow budget can cover the total", async () => {
    const f = await pendingReview();
    const goal = randomUUID(), run = randomUUID();
    const approval = (await db.query("select id from generation_approvals where job_id=$1", [f.job.id])).rows[0];
    await db.query("update generation_approvals set context=jsonb_build_object('workflowGoalId',$2::text) where id=$1", [approval.id, goal]);
    await db.query("insert into canvas_workflow_runs(id,goal_id,budget_credits) values($1,$2,3)", [run, goal]);
    await db.query("insert into canvas_workflow_budget_reservations(approval_id,run_id,credits) values($1,$2,3)", [approval.id, run]);
    await expect(decideSettlementReview(db, f.job.id, f.userId, f.review.id, "approve")).rejects.toThrow("超过工作流预算");
    expect(await f.balance()).toBe(97);
    expect((await f.jobs.getJobAdmin(f.job.id)).settlement_review?.status).toBe("pending");
    await db.query("update canvas_workflow_runs set budget_credits=4 where id=$1", [run]);
    await decideSettlementReview(db, f.job.id, f.userId, f.review.id, "approve");
    expect(await f.balance()).toBe(96.4);
    expect(Number((await db.query("select credits from canvas_workflow_budget_reservations where approval_id=$1", [approval.id])).rows[0].credits)).toBe(3.6);
  });

  it("uses the funded approval's workflow budget when an older quote is also linked", async () => {
    const f = await fixture();
    const job = await f.jobs.createJob(f.user, { workspaceId: f.workspaceId, jobType: "video_generation",
      payload: { model: "MiniMax-H3", duration: 10 }, requiresCreditReservation: true });
    const approvals = createGenerationApprovalService(db);
    const goal = randomUUID(), run = randomUUID();
    let fundedApproval = "";
    for (const workflow of [false, true]) {
      const quote = await approvals.gate({ workspaceId: f.workspaceId, userId: f.userId, jobType: "video_generation",
        model: "MiniMax-H3", payload: job.payload, estimatedCredits: 3, forceConfirmation: true,
        context: { reservationJobId: job.id, websiteCaptureTaskId: workflow ? "workflow-quote" : "older-quote" } });
      if (quote.state !== "confirmation_required") throw new Error("Expected explicit quote");
      await approvals.approve({ approvalId: quote.request.approvalId, workspaceId: f.workspaceId, userId: f.userId });
      expect(await approvals.attachJob(quote.request.approvalId, job.id)).toBe(job.id);
      if (workflow) fundedApproval = quote.request.approvalId;
    }
    await db.query("update generation_approvals set context=context || jsonb_build_object('workflowGoalId',$2::text) where id=$1", [fundedApproval, goal]);
    await f.credits.deductCredits(f.workspaceId, f.userId, 3, job.id, "Funded workflow quote", fundedApproval);
    await db.query("insert into canvas_workflow_runs(id,goal_id,budget_credits) values($1,$2,3)", [run, goal]);
    await db.query("insert into canvas_workflow_budget_reservations(approval_id,run_id,credits) values($1,$2,3)", [fundedApproval, run]);
    await db.query("update background_jobs set status='running',started_at=now(),attempt_count=1 where id=$1", [job.id]);
    await expect(reconcileGenerationBilling(job.id, { duration_seconds: 12, duration_source: "provider" },
      { jobService: f.jobs, localDb: db }, "[workflow-quote]")).rejects.toMatchObject({ code: "generation_settlement_review_required" });
    await db.query("update background_jobs set status='sync_failed' where id=$1", [job.id]);
    const review = (await f.jobs.getJobAdmin(job.id)).settlement_review!;

    await expect(decideSettlementReview(db, job.id, f.userId, review.id, "approve")).rejects.toThrow("超过工作流预算");
    expect(await f.balance()).toBe(94);
    expect((await f.jobs.getJobAdmin(job.id)).settlement_review?.status).toBe("pending");
    await db.query("update canvas_workflow_runs set budget_credits=4 where id=$1", [run]);
    await decideSettlementReview(db, job.id, f.userId, review.id, "approve");
    expect(await f.balance()).toBe(93.4);
    expect(Number((await db.query("select credits from canvas_workflow_budget_reservations where approval_id=$1", [fundedApproval])).rows[0].credits)).toBe(3.6);
  });

  it("recovers delivery after settlement committed but the response and delivery transition were lost", async () => {
    const f = await pendingReview();
    await decideSettlementReview(db, f.job.id, f.userId, f.review.id, "approve");
    await db.query("update background_jobs set status='sync_failed' where id=$1", [f.job.id]);
    await decideSettlementReview(db, f.job.id, f.userId, f.review.id, "approve");
    expect(await f.balance()).toBe(96.4);
    expect(await f.ledger()).toHaveLength(2);
    expect((await f.jobs.getJobAdmin(f.job.id)).status).toBe("sync_pending");
  });
});
