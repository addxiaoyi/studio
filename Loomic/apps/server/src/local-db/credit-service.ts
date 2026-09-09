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
    async createTopupOrder(workspaceId, packageId, provider) {
      const pkg = getTopupPackage(packageId);
      if (!pkg) throw new CreditServiceError("topup_failed", `Unknown topup package: ${packageId}`, 400);
      const outTradeNo = `HT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const now = Date.now(); const expiredAt = now + 30 * 60 * 1000; const creditsGranted = pkg.credits + (pkg.bonusCredits ?? 0);
      await db.query("insert into credit_topups (out_trade_no, workspace_id, package_id, amount_cny_fen, amount_usd_cents, credits_granted, provider, expired_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [outTradeNo, workspaceId, packageId, pkg.priceCnyFen, pkg.priceUsdCents, creditsGranted, provider, expiredAt, now]);
      return { outTradeNo, workspaceId, packageId, amountCnyFen: pkg.priceCnyFen, amountUsdCents: pkg.priceUsdCents, creditsGranted, status: "pending", provider, qrCodeUrl: null, expiredAt, paidAt: null, createdAt: now };
    },
    async getTopupOrder(outTradeNo) {
      const { rows } = await db.query("select * from credit_topups where out_trade_no = $1", [outTradeNo]); const row = rows[0]; if (!row) return null;
      const status = row.status === "pending" && row.expired_at < Date.now() ? "expired" : row.status;
      return { outTradeNo: row.out_trade_no, workspaceId: row.workspace_id, packageId: row.package_id, amountCnyFen: row.amount_cny_fen, amountUsdCents: row.amount_usd_cents, creditsGranted: row.credits_granted, status, provider: row.provider, qrCodeUrl: row.qr_code_url ?? null, expiredAt: row.expired_at, paidAt: row.paid_at ?? null, createdAt: row.created_at } as TopupOrder;
    },
    async activateTopup(outTradeNo, providerTradeNo) {
      const client = await db.connect();
      try {
        await client.query("begin");
        const { rows } = await client.query("select * from credit_topups where out_trade_no = $1 for update", [outTradeNo]); const order = rows[0];
        if (!order) throw new CreditServiceError("topup_activate_failed", "Topup order not found.", 404);
        if (order.status === "paid") { const balance = await client.query("select balance from credit_balances where workspace_id = $1", [order.workspace_id]); await client.query("commit"); return { creditsGranted: order.credits_granted, balance: balance.rows[0]?.balance ?? 0 }; }
        if (order.status !== "pending" || order.expired_at < Date.now()) throw new CreditServiceError("topup_activate_failed", "Topup order is expired or unavailable.", 409);
        await client.query("update credit_topups set status = 'paid', trade_no = $1, paid_at = $2 where out_trade_no = $3", [providerTradeNo, Date.now(), outTradeNo]);
        await client.query("insert into credit_balances (workspace_id, balance) values ($1, 0) on conflict do nothing", [order.workspace_id]);
        const balance = await client.query("update credit_balances set balance = balance + $1, updated_at = now() where workspace_id = $2 returning balance", [order.credits_granted, order.workspace_id]);
        await client.query("insert into credit_transactions (workspace_id, transaction_type, amount, balance_after, description) values ($1, 'topup', $2, $3, $4)", [order.workspace_id, order.credits_granted, balance.rows[0].balance, `充值 ${order.package_id} 套餐`]);
        await client.query("commit"); return { creditsGranted: order.credits_granted, balance: balance.rows[0].balance };
      } catch (error) { await client.query("rollback"); if (error instanceof CreditServiceError) throw error; throw new CreditServiceError("topup_activate_failed", "Failed to activate top-up.", 500); } finally { client.release(); }
    },
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
