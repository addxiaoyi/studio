import { randomUUID } from "node:crypto";
import { generationSettlementSchema, settlementReviewSchema, type GenerationSettlement } from "@helstera/shared";
import type { Pool } from "pg";
import { CreditServiceError } from "../features/credits/credit-service.js";

const CREDIT_SCALE = 10_000;
const MAX_CREDIT_UNITS = 99_999_999_999_999;

export class GenerationSettlementError extends Error {
  readonly code = "generation_settlement_review_required";
}

function units(value: number): number {
  const scaled = Math.round(value * CREDIT_SCALE);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(scaled) || scaled > MAX_CREDIT_UNITS) {
    throw new GenerationSettlementError("Generation settlement requires a valid non-negative credit amount.");
  }
  return scaled;
}

type JobBalance = {
  workspace_id: string;
  created_by: string;
  status: string;
  credits_cost: string | null;
  credits_transaction_id: string | null;
  billing_approval_id: string | null;
  billing_receipt: unknown;
  settlement_review: unknown;
};

type LedgerEntry = { id: string; transaction_type: string; amount: string };

export async function settleGenerationCredits(
  db: Pool,
  jobId: string,
  charge: { actualCost: number; description: string; basis: GenerationSettlement["basis"] },
  output?: Record<string, unknown>,
): Promise<GenerationSettlement> {
  const actualUnits = units(charge.actualCost);
  const client = await db.connect();
  try {
    await client.query("begin");
    // Lock the job before its balance so a second Worker cannot settle the same output twice.
    const job = (await client.query<JobBalance>(
      "select workspace_id,created_by,status,credits_cost,credits_transaction_id,billing_approval_id,billing_receipt,settlement_review from background_jobs where id=$1 for update",
      [jobId],
    )).rows[0];
    if (!job) throw new GenerationSettlementError("The generation job no longer exists.");
    if (job.billing_receipt) {
      const receipt = generationSettlementSchema.parse(job.billing_receipt);
      if (units(receipt.settledCredits) !== actualUnits || JSON.stringify(receipt.basis) !== JSON.stringify(charge.basis)) {
        throw new GenerationSettlementError("This job already has a different settlement receipt. Review the original usage before changing it.");
      }
      await client.query("commit");
      return receipt;
    }
    if (!["running", "sync_pending", "sync_failed"].includes(job.status)) {
      throw new GenerationSettlementError("Only a running or recoverable generation can be settled.");
    }
    const balance = (await client.query<{ balance: string }>(
      "select balance from credit_balances where workspace_id=$1 for update", [job.workspace_id],
    )).rows[0];
    if (!balance) throw new GenerationSettlementError("The generation credit balance is unavailable.");
    const ledger = await client.query<LedgerEntry>(
      `select id,transaction_type,amount from credit_transactions where workspace_id=$1 and user_id=$2 and job_id=$3
        and transaction_type in ('generation_deduct','generation_refund','generation_adjustment')`,
      [job.workspace_id, job.created_by, jobId],
    );
    const debit = ledger.rows.find(entry => entry.id === job.credits_transaction_id && entry.transaction_type === "generation_deduct");
    const reservedUnits = units(Number(job.credits_cost ?? 0));
    const freeJob = reservedUnits === 0 && !job.credits_transaction_id && !ledger.rows.length;
    if (!freeJob && (!debit || ledger.rows.length !== 1 || units(-Number(debit.amount)) !== reservedUnits)) {
      throw new GenerationSettlementError("The reservation and credit ledger disagree. Review the existing charge or refund before settlement.");
    }
    if (freeJob && actualUnits > 0) {
      throw new GenerationSettlementError("A generation without a credit reservation cannot be charged during settlement.");
    }
    const approval = (await client.query<{ estimated_credits: string }>(
      `select approval.estimated_credits from generation_approvals approval join background_jobs job on job.id=approval.job_id
        where approval.job_id=$1 and approval.workspace_id=$2 and approval.user_id=$3
        and approval.status='approved' and approval.consumed_at is not null
        and (job.billing_approval_id is null or approval.id=job.billing_approval_id)
        order by approval.approved_at desc nulls last,approval.created_at desc,approval.id limit 1`,
      [jobId, job.workspace_id, job.created_by],
    )).rows[0];
    if (job.billing_approval_id && !approval) {
      throw new GenerationSettlementError("The task's confirmed quote is unavailable. Review the original approval before settlement.");
    }
    if (approval && actualUnits > units(Number(approval.estimated_credits))) {
      const previous = settlementReviewSchema.safeParse(job.settlement_review);
      const matches = previous.success && units(previous.data.actualCost) === actualUnits
        && JSON.stringify(previous.data.basis) === JSON.stringify(charge.basis);
      if (!matches || previous.data.status !== "approved") {
        const review = matches ? previous.data : settlementReviewSchema.parse({
          id: randomUUID(), status: "pending", actualCost: actualUnits / CREDIT_SCALE,
          reservedCredits: reservedUnits / CREDIT_SCALE, additionalCredits: (actualUnits - reservedUnits) / CREDIT_SCALE,
          description: charge.description, basis: charge.basis, createdAt: new Date().toISOString(),
        });
        await client.query("update background_jobs set settlement_review=$2::jsonb,result=coalesce($3::jsonb,result),updated_at=now() where id=$1",
          [jobId, JSON.stringify(review), output ? JSON.stringify(output) : null]);
        await client.query("commit");
        throw new GenerationSettlementError(review.status === "rejected"
          ? "已拒绝额外费用，未补扣积分；原任务和预扣记录已保留。"
          : "实际费用超过已确认额度，结果和原预扣已保留，请确认额外费用后再结算。");
      }
    }
    const deltaUnits = reservedUnits - actualUnits;
    const nextUnits = units(Number(balance.balance)) + deltaUnits;
    if (nextUnits < 0) throw new CreditServiceError("insufficient_credits", "积分不足以完成本次用量结算，原结果和预扣记录已保留。", 402);
    units(nextUnits / CREDIT_SCALE);
    let transactionId: string | null = null;
    if (deltaUnits !== 0) {
      await client.query("update credit_balances set balance=$1,updated_at=now() where workspace_id=$2", [nextUnits / CREDIT_SCALE, job.workspace_id]);
      transactionId = (await client.query<{ id: string }>(
        `insert into credit_transactions(workspace_id,user_id,transaction_type,amount,balance_after,job_id,description)
          values($1,$2,'generation_adjustment',$3,$4,$5,$6) returning id`,
        [job.workspace_id, job.created_by, deltaUnits / CREDIT_SCALE, nextUnits / CREDIT_SCALE, jobId, charge.description],
      )).rows[0]!.id;
    }
    const receipt = generationSettlementSchema.parse({
      version: 1, reservedCredits: reservedUnits / CREDIT_SCALE, settledCredits: actualUnits / CREDIT_SCALE,
      balanceDelta: deltaUnits / CREDIT_SCALE, reservationTransactionId: job.credits_transaction_id,
      adjustmentTransactionId: transactionId, basis: charge.basis, settledAt: new Date().toISOString(),
    });
    // Keep the original debit ID: approval replay must still refer to the reservation.
    await client.query(`update background_jobs set credits_cost=$2,billing_receipt=$3::jsonb,
      settlement_review=case when (settlement_review->>'actualCost')::numeric=$2
        then jsonb_set(settlement_review,'{status}','"consumed"'::jsonb) else null end,updated_at=now() where id=$1`,
      [jobId, receipt.settledCredits, JSON.stringify(receipt)]);
    await client.query("commit");
    return receipt;
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  } finally {
    client.release();
  }
}
