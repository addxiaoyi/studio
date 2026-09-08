// @payments-yeepay — YeePay business service: topup order creation, webhook handling
import type { AdminSupabaseClient } from "../../supabase/admin.js";
import type { TopupPackage } from "@helstera/shared";
import { getTopupPackage } from "@helstera/shared";

import { YeePayClient, type YeePayWebhookPayload } from "./yeepay-client.js";

// ── Types ───────────────────────────────────────────────────

export type YeePayOrder = {
  outTradeNo: string;
  workspaceId: string;
  packageId: string;
  amountCnyFen: number;
  creditsGranted: number;
  status: "pending" | "paid" | "failed" | "refunded";
  tradeNo: string | null;
  qrCodeUrl: string | null;
  expiredAt: number;
  createdAt: number;
  paidAt: number | null;
};

export type YeePayServiceOptions = {
  client: YeePayClient;
  getAdminClient: () => AdminSupabaseClient;
  notifyUrl: string;
};

// ── Pricing ─────────────────────────────────────────────────
//
// Top-up packages are already priced in CNY fen — no FX conversion needed.
// YeePay receives the package's priceCnyFen directly.

export function resolveYeePayTopupAmount(
  packageId: string,
): { totalAmount: number; package: TopupPackage } {
  const pkg = getTopupPackage(packageId);
  if (!pkg) {
    throw new Error(`Unknown topup package: ${packageId}`);
  }
  return { totalAmount: pkg.priceCnyFen, package: pkg };
}

export function formatYeePayAmount(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`;
}

// ── Order lifecycle ─────────────────────────────────────────

export class YeePayService {
  private readonly client: YeePayClient;
  private readonly getAdminClient: () => AdminSupabaseClient;
  private readonly notifyUrl: string;

  constructor(options: YeePayServiceOptions) {
    this.client = options.client;
    this.getAdminClient = options.getAdminClient;
    this.notifyUrl = options.notifyUrl;
  }

  /**
   * Create a pending topup order in DB + YeePay, return QR code info.
   */
  async createTopupOrder(params: {
    workspaceId: string;
    packageId: string;
  }): Promise<{
    outTradeNo: string;
    qrCodeUrl: string;
    qrCodeImage: string;
    expiredAt: number;
  }> {
    const { totalAmount, package: pkg } = resolveYeePayTopupAmount(
      params.packageId,
    );
    const outTradeNo = this.generateOutTradeNo(params.workspaceId);
    const now = Date.now();
    const expiredAt = now + 30 * 60 * 1000; // 30 min expiry
    const creditsGranted = pkg.credits + (pkg.bonusCredits ?? 0);

    // 1. Insert pending topup order in credit_topups table
    const admin = this.getAdminClient();
    const { error: insertError } = await (admin as any)
      .from("credit_topups")
      .insert({
        out_trade_no: outTradeNo,
        workspace_id: params.workspaceId,
        package_id: params.packageId,
        amount_cny_fen: totalAmount,
        amount_usd_cents: 0,
        credits_granted: creditsGranted,
        status: "pending",
        provider: "yeepay",
        expired_at: expiredAt,
        created_at: now,
      });

    if (insertError) {
      console.error("[YeePayService] Failed to insert topup:", insertError);
    }

    // 2. Call YeePay API to get QR code
    const yeePayResult = await this.client.createOrder({
      outTradeNo,
      totalAmount,
      subject: `Helstera 充值 - ${pkg.name}（${formatYeePayAmount(totalAmount)}）`,
      notifyUrl: this.notifyUrl,
      ext: {
        workspace_id: params.workspaceId,
        package_id: params.packageId,
      },
    });

    // 3. Update order with YeePay response
    await (admin as any)
      .from("credit_topups")
      .update({
        trade_no: yeePayResult.tradeNo,
        qr_code_url: yeePayResult.qrCodeUrl,
      })
      .eq("out_trade_no", outTradeNo);

    return {
      outTradeNo,
      qrCodeUrl: yeePayResult.qrCodeUrl,
      qrCodeImage: yeePayResult.qrCodeImage,
      expiredAt: yeePayResult.expiredAt,
    };
  }

  /**
   * Handle webhook callback after successful payment.
   * Verifies signature, marks topup paid, and adds credits to balance.
   */
  async handleWebhook(
    payload: YeePayWebhookPayload,
  ): Promise<{
    outTradeNo: string;
    action: "activated" | "already_processed" | "invalid_signature";
  }> {
    // 1. Verify signature
    if (!this.client.verifyWebhook(payload)) {
      console.warn("[YeePayService] Invalid webhook signature");
      return { outTradeNo: payload.outTradeNo, action: "invalid_signature" };
    }

    const admin = this.getAdminClient();

    // 2. Check idempotency
    const { data: order, error: fetchError } = await (admin as any)
      .from("credit_topups")
      .select("*")
      .eq("out_trade_no", payload.outTradeNo)
      .single();

    if (fetchError || !order) {
      console.error(
        "[YeePayService] Topup order not found:",
        payload.outTradeNo,
      );
      throw new Error(`YeePay topup order ${payload.outTradeNo} not found`);
    }

    if (order.status === "paid") {
      return { outTradeNo: payload.outTradeNo, action: "already_processed" };
    }

    // 3. Verify amount
    const paidAmount = Number(payload.totalAmount);
    if (paidAmount !== Number(order.amount_cny_fen)) {
      console.error(
        `[YeePayService] Amount mismatch: paid ${payload.totalAmount} vs expected ${order.amount_cny_fen}`,
      );
      throw new Error("Payment amount mismatch");
    }

    // 4. Mark order as paid
    await (admin as any)
      .from("credit_topups")
      .update({
        status: "paid",
        paid_at: Number(payload.successTime),
        trade_no: payload.tradeNo,
      })
      .eq("out_trade_no", payload.outTradeNo);

    // 5. Add credits to balance + record transaction
    const { error: addError } = await admin.rpc(
      "add_credits" as never,
      {
        p_workspace_id: order.workspace_id,
        p_amount: order.credits_granted,
        p_description: `YeePay 充值 ${order.package_id} 套餐`,
        p_type: "topup",
      } as never,
    );

    if (addError) {
      console.error("[YeePayService] add_credits failed:", addError);
      throw new Error(`Failed to add credits: ${addError.message}`);
    }

    return { outTradeNo: payload.outTradeNo, action: "activated" };
  }

  /**
   * Poll order status.
   */
  async getOrderStatus(outTradeNo: string): Promise<{
    status: "pending" | "paid" | "failed" | "expired";
    paidAt: number | null;
  }> {
    const admin = this.getAdminClient();
    const { data: order } = await (admin as any)
      .from("credit_topups")
      .select("status, paid_at, expired_at")
      .eq("out_trade_no", outTradeNo)
      .single();

    if (!order) {
      return { status: "failed", paidAt: null };
    }

    let status: "pending" | "paid" | "failed" | "expired" = order.status as
      | "pending"
      | "paid"
      | "failed";
    if (status === "pending" && order.expired_at < Date.now()) {
      status = "expired";
    }

    return {
      status,
      paidAt: order.paid_at ?? null,
    };
  }

  // ── Helpers ─────────────────────────────────────────────

  private generateOutTradeNo(_workspaceId: string): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
    return `HT${ts}${rand}`;
  }
}
