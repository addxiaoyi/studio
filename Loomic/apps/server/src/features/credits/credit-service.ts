// @credits-system — Core credit operations: balance queries, deductions, refunds, topups
import type { CreditTransactionType, TopupPackage } from "@helstera/shared";
import {
  TOPUP_PACKAGES,
  applyTopupVariants,
  getTopupPackage,
} from "@helstera/shared";

import type { AdminSupabaseClient } from "../../supabase/admin.js";

// ── Error ────────────────────────────────────────────────────

export class CreditServiceError extends Error {
  readonly statusCode: number;
  readonly code:
    | "insufficient_credits"
    | "credit_query_failed"
    | "credit_deduct_failed"
    | "credit_refund_failed"
    | "topup_failed"
    | "topup_activate_failed";

  constructor(
    code: CreditServiceError["code"],
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.name = "CreditServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ── Types ────────────────────────────────────────────────────

export type BalanceInfo = {
  balance: number;
  totalToppedUp: number;
  totalSpent: number;
};

export type TopupOrder = {
  outTradeNo: string;
  workspaceId: string;
  packageId: string;
  amountCnyFen: number;
  amountUsdCents: number;
  creditsGranted: number;
  status: "pending" | "paid" | "failed" | "refunded" | "expired";
  provider: "yeepay" | "epay" | "lemonsqueezy" | "manual";
  qrCodeUrl: string | null;
  expiredAt: number;
  paidAt: number | null;
  createdAt: number;
};

export type CreditTransactionRow = {
  id: string;
  transaction_type: CreditTransactionType;
  amount: number;
  balance_after: number | null;
  job_id: string | null;
  description: string | null;
  created_at: number;
};

export type CreditService = {
  getBalance(workspaceId: string): Promise<BalanceInfo>;
  deductCredits(
    workspaceId: string,
    userId: string,
    amount: number,
    jobId?: string,
    description?: string,
  ): Promise<string>;
  refundCredits(
    workspaceId: string,
    userId: string,
    amount: number,
    jobId: string,
    description?: string,
  ): Promise<string>;
  getTransactions(
    workspaceId: string,
    limit?: number,
  ): Promise<CreditTransactionRow[]>;

  // New top-up flow
  listTopupPackages(): TopupPackage[];
  createTopupOrder(
    workspaceId: string,
    packageId: string,
    provider: "yeepay" | "epay" | "lemonsqueezy",
  ): Promise<TopupOrder>;
  getTopupOrder(outTradeNo: string): Promise<TopupOrder | null>;
  activateTopup(
    outTradeNo: string,
    providerTradeNo: string | null,
  ): Promise<{ creditsGranted: number; balance: number }>;
};

// ── Helpers ──────────────────────────────────────────────────

function generateOutTradeNo(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `HT${ts}${rand}`;
}

// ── Factory ──────────────────────────────────────────────────

export function createCreditService(options: {
  getAdminClient: () => AdminSupabaseClient;
}): CreditService {
  return {
    async getBalance(workspaceId) {
      const admin = options.getAdminClient();

      // Aggregated balance + lifetime stats in one query
      const [balanceResult, topupResult, deductResult] = await Promise.all([
        admin
          .from("credit_balances")
          .select("balance")
          .eq("workspace_id", workspaceId)
          .maybeSingle(),
        admin
          .from("credit_transactions")
          .select("amount")
          .eq("workspace_id", workspaceId)
          .eq("transaction_type", "topup" as never),
        admin
          .from("credit_transactions")
          .select("amount")
          .eq("workspace_id", workspaceId)
          .eq("transaction_type", "generation_deduct"),
      ]);

      if (balanceResult.error) {
        throw new CreditServiceError(
          "credit_query_failed",
          `balance: ${balanceResult.error.message}`,
          500,
        );
      }

      const totalToppedUp = (topupResult.data ?? []).reduce(
        (sum, row) => sum + (row.amount ?? 0),
        0,
      );
      const totalSpent = (deductResult.data ?? []).reduce(
        (sum, row) => sum + Math.abs(row.amount ?? 0),
        0,
      );

      return {
        balance: balanceResult.data?.balance ?? 0,
        totalToppedUp,
        totalSpent,
      };
    },

    async deductCredits(workspaceId, userId, amount, jobId, description) {
      const admin = options.getAdminClient();

      const { data, error } = await admin.rpc("deduct_credits", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_amount: amount,
        p_job_id: (jobId ?? null) as string,
        p_description: (description ?? null) as string,
      });

      if (error) {
        if (error.message?.includes("INSUFFICIENT_CREDITS")) {
          throw new CreditServiceError(
            "insufficient_credits",
            "Not enough credits to perform this action.",
            402,
          );
        }
        throw new CreditServiceError(
          "credit_deduct_failed",
          `Failed to deduct credits: ${error.message}`,
          500,
        );
      }

      return data as string;
    },

    async refundCredits(workspaceId, userId, amount, jobId, description) {
      const admin = options.getAdminClient();

      const { data, error } = await admin.rpc("refund_credits", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_amount: amount,
        p_job_id: jobId ?? null,
        p_description: description ?? null,
      });

      if (error) {
        throw new CreditServiceError(
          "credit_refund_failed",
          `Failed to refund credits: ${error.message}`,
          500,
        );
      }

      return data as string;
    },

    async getTransactions(workspaceId, limit = 20) {
      const admin = options.getAdminClient();
      const safeLimit = Math.min(Math.max(limit, 1), 100);

      const { data, error } = await admin
        .from("credit_transactions")
        .select(
          "id, transaction_type, amount, balance_after, job_id, description, created_at",
        )
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(safeLimit);

      if (error) {
        throw new CreditServiceError(
          "credit_query_failed",
          "Failed to query transactions.",
          500,
        );
      }

      return (data ?? []) as unknown as CreditTransactionRow[];
    },

    // ── Top-up methods ─────────────────────────────────────

    listTopupPackages() {
      return applyTopupVariants(process.env as unknown as Record<string, string | undefined>);
    },

    async createTopupOrder(workspaceId, packageId, provider) {
      const pkg = getTopupPackage(packageId);
      if (!pkg) {
        throw new CreditServiceError(
          "topup_failed",
          `Unknown topup package: ${packageId}`,
          400,
        );
      }

      const admin = options.getAdminClient();
      const outTradeNo = generateOutTradeNo();
      const now = Date.now();
      const expiredAt = now + 30 * 60 * 1000; // 30 min expiry
      const totalCredits = pkg.credits + (pkg.bonusCredits ?? 0);

      const { error: insertError } = await (admin as any)
        .from("credit_topups")
        .insert({
          out_trade_no: outTradeNo,
          workspace_id: workspaceId,
          package_id: packageId,
          amount_cny_fen: pkg.priceCnyFen,
          amount_usd_cents: pkg.priceUsdCents,
          credits_granted: totalCredits,
          status: "pending",
          provider,
          expired_at: expiredAt,
          created_at: now,
        });

      if (insertError) {
        throw new CreditServiceError(
          "topup_failed",
          `Failed to create topup order: ${insertError.message}`,
          500,
        );
      }

      return {
        outTradeNo,
        workspaceId,
        packageId,
        amountCnyFen: pkg.priceCnyFen,
        amountUsdCents: pkg.priceUsdCents,
        creditsGranted: totalCredits,
        status: "pending",
        provider,
        qrCodeUrl: null,
        expiredAt,
        paidAt: null,
        createdAt: now,
      };
    },

    async getTopupOrder(outTradeNo) {
      const admin = options.getAdminClient();
      const { data } = await (admin as any)
        .from("credit_topups")
        .select("*")
        .eq("out_trade_no", outTradeNo)
        .maybeSingle();

      if (!data) return null;

      // Auto-expire
      let status = data.status as TopupOrder["status"];
      if (status === "pending" && data.expired_at < Date.now()) {
        status = "expired";
      }

      return {
        outTradeNo: data.out_trade_no,
        workspaceId: data.workspace_id,
        packageId: data.package_id,
        amountCnyFen: data.amount_cny_fen,
        amountUsdCents: data.amount_usd_cents,
        creditsGranted: data.credits_granted,
        status,
        provider: data.provider,
        qrCodeUrl: data.qr_code_url ?? null,
        expiredAt: data.expired_at,
        paidAt: data.paid_at ?? null,
        createdAt: data.created_at,
      };
    },

    async activateTopup(outTradeNo, providerTradeNo) {
      const admin = options.getAdminClient();
      const now = Date.now();

      // 1. Lock the order row
      const { data: order, error: fetchError } = await (admin as any)
        .from("credit_topups")
        .select("*")
        .eq("out_trade_no", outTradeNo)
        .single();

      if (fetchError || !order) {
        throw new CreditServiceError(
          "topup_activate_failed",
          `Topup order not found: ${outTradeNo}`,
          404,
        );
      }

      if (order.status === "paid") {
        // Idempotent — return current balance
        const { data: balance } = await admin
          .from("credit_balances")
          .select("balance")
          .eq("workspace_id", order.workspace_id)
          .maybeSingle();
        return {
          creditsGranted: order.credits_granted,
          balance: balance?.balance ?? 0,
        };
      }

      // 2. Mark as paid
      await (admin as any)
        .from("credit_topups")
        .update({
          status: "paid",
          paid_at: now,
          trade_no: providerTradeNo ?? order.trade_no,
        })
        .eq("out_trade_no", outTradeNo);

      // 3. Add credits to balance + record transaction (atomic)
      const { data: balance, error: addError } = await admin.rpc(
        "add_credits" as never,
        {
          p_workspace_id: order.workspace_id,
          p_amount: order.credits_granted,
          p_description: `充值 ${order.package_id} 套餐`,
          p_type: "topup",
        } as never,
      );

      if (addError) {
        console.error("[credit-service] add_credits failed:", addError);
        throw new CreditServiceError(
          "topup_activate_failed",
          `Failed to add credits: ${addError.message}`,
          500,
        );
      }

      return {
        creditsGranted: order.credits_granted,
        balance: (balance as { new_balance: number })?.new_balance ?? 0,
      };
    },
  };
}
