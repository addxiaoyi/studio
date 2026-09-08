import type { Pool } from "pg";
import type { CreditTransactionType, TopupPackage } from "@helstera/shared";
import { applyTopupVariants, getTopupPackage } from "@helstera/shared";
import { CreditServiceError, type BalanceInfo, type CreditService, type CreditTransactionRow, type TopupOrder } from "../features/credits/credit-service.js";

export function createLocalCreditService(db: Pool): CreditService {
  return {
    async getBalance(workspaceId): Promise<BalanceInfo> {
      const { rows } = await db.query("select coalesce((select balance from credit_balances where workspace_id = $1), 0) as balance, coalesce((select sum(amount) from credit_transactions where workspace_id = $1 and transaction_type = 'topup'), 0) as topped, coalesce((select sum(abs(amount)) from credit_transactions where workspace_id = $1 and transaction_type = 'generation_deduct'), 0) as spent", [workspaceId]);
      return { balance: Number(rows[0].balance), totalToppedUp: Number(rows[0].topped), totalSpent: Number(rows[0].spent) };
    },
    async deductCredits(workspaceId, userId, amount, jobId, description) { return changeBalance(db, workspaceId, userId, -amount, "generation_deduct", jobId, description); },
    async refundCredits(workspaceId, userId, amount, jobId, description) { return changeBalance(db, workspaceId, userId, amount, "generation_refund", jobId, description); },
    async getTransactions(workspaceId, limit = 20): Promise<CreditTransactionRow[]> {
      const { rows } = await db.query("select id, transaction_type, amount, balance_after, job_id, description, extract(epoch from created_at) * 1000 as created_at from credit_transactions where workspace_id = $1 order by created_at desc limit $2", [workspaceId, Math.min(Math.max(limit, 1), 100)]);
      return rows as CreditTransactionRow[];
    },
    listTopupPackages() { return applyTopupVariants(process.env as Record<string, string | undefined>); },
    async createTopupOrder(_workspaceId, packageId, _provider) { throw new CreditServiceError("topup_failed", `Local top-up is not migrated: ${packageId}`, 503); },
    async getTopupOrder(_outTradeNo): Promise<TopupOrder | null> { return null; },
    async activateTopup(_outTradeNo, _providerTradeNo) { throw new CreditServiceError("topup_activate_failed", "Local top-up is not migrated.", 503); },
  };
}

async function changeBalance(db: Pool, workspaceId: string, userId: string, amount: number, type: CreditTransactionType, jobId?: string, description?: string) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const balance = await client.query("insert into credit_balances (workspace_id, balance) values ($1, 0) on conflict (workspace_id) do update set updated_at = now() returning balance", [workspaceId]);
    const next = Number(balance.rows[0].balance) + amount;
    if (next < 0) throw new CreditServiceError("insufficient_credits", "Not enough credits to perform this action.", 402);
    await client.query("update credit_balances set balance = $1, updated_at = now() where workspace_id = $2", [next, workspaceId]);
    const { rows } = await client.query("insert into credit_transactions (workspace_id, user_id, transaction_type, amount, balance_after, job_id, description) values ($1,$2,$3,$4,$5,$6,$7) returning id", [workspaceId, userId, type, amount, next, jobId ?? null, description ?? null]);
    await client.query("commit");
    return rows[0].id as string;
  } catch (error) { await client.query("rollback"); if (error instanceof CreditServiceError) throw error; throw new CreditServiceError("credit_deduct_failed", "Failed to update credits.", 500); } finally { client.release(); }
}
