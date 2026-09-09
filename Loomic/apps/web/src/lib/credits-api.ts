// @credits-system — Frontend API client for credit balance, transactions, and top-ups
import type { TopupPackage } from "@helstera/shared";

import { getServerBaseUrl } from "./env";
import { ApiAuthError, ApiApplicationError } from "./server-api";

// ── Types (local — kept simple) ─────────────────────────────

export type CreditBalance = {
  balance: number;
  totalToppedUp: number;
  totalSpent: number;
};

export type CreditTransaction = {
  id: string;
  transaction_type: string;
  amount: number;
  balance_after: number | null;
  job_id: string | null;
  description: string | null;
  created_at: number;
};

export type TopupOrder = {
  outTradeNo: string;
  workspaceId: string;
  packageId: string;
  amountCnyFen: number;
  amountUsdCents: number;
  creditsGranted: number;
  status: "pending" | "paid" | "failed" | "refunded" | "expired";
  provider: "yeepay" | "lemonsqueezy" | "manual";
  qrCodeUrl: string | null;
  expiredAt: number;
  paidAt: number | null;
  createdAt: number;
};

// ── Helpers ──────────────────────────────────────────────────

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function authJsonHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
}

async function handleErrorResponse(response: Response): Promise<never> {
  if (response.status === 401) {
    throw new ApiAuthError();
  }
  const body = await response.json().catch(() => null);
  const code = body?.error?.code ?? "application_error";
  const message = body?.error?.message ?? "Request failed";
  throw new ApiApplicationError(code, message);
}

// ── Credit APIs ──────────────────────────────────────────────

export async function fetchCredits(
  accessToken: string,
): Promise<CreditBalance> {
  const response = await fetch(`${getServerBaseUrl()}/api/credits`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as CreditBalance;
}

export async function fetchCreditTransactions(
  accessToken: string,
  limit = 20,
): Promise<{ transactions: CreditTransaction[] }> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/credits/transactions?limit=${limit}`,
    { headers: authHeaders(accessToken), credentials: "include" },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { transactions: CreditTransaction[] };
}

export async function fetchTopupPackages(): Promise<{ packages: TopupPackage[] }> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/credits/packages`,
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { packages: TopupPackage[] };
}

export async function createTopupOrder(
  accessToken: string,
  packageId: string,
): Promise<{ order: TopupOrder }> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/credits/topup`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      credentials: "include",
      body: JSON.stringify({ packageId }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { order: TopupOrder };
}

/**
 * Create a Lemon Squeezy checkout URL for international (USD) top-ups.
 * Returns the redirect URL + the pending order record.
 */
export async function createTopupCheckout(
  accessToken: string,
  packageId: string,
): Promise<{ order: TopupOrder; checkoutUrl: string }> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/credits/topup-checkout`,
    {
      method: "POST",
      headers: authJsonHeaders(accessToken),
      credentials: "include",
      body: JSON.stringify({ packageId }),
    },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { order: TopupOrder; checkoutUrl: string };
}

export async function getTopupOrder(
  accessToken: string,
  outTradeNo: string,
): Promise<{ order: TopupOrder }> {
  const response = await fetch(
    `${getServerBaseUrl()}/api/credits/topup/${encodeURIComponent(outTradeNo)}`,
    { headers: authHeaders(accessToken), credentials: "include" },
  );
  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as { order: TopupOrder };
}
