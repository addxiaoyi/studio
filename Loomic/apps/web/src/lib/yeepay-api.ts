// @payments-yeepay — YeePay (易支付) frontend API client
// China market provider — Native/QR scan pay for credit top-ups

export type YeePayTopupResult = {
  outTradeNo: string;
  qrCodeUrl: string;
  qrCodeImage: string;
  expiredAt: number;
};

export type YeePayOrderStatus = {
  status: "pending" | "paid" | "failed" | "expired";
  paidAt: number | null;
};

/**
 * Create a YeePay Native/QR topup order.
 * Returns QR code image (Base64) and URL for display.
 */
export async function createYeePayTopup(
  accessToken: string,
  packageId: string,
): Promise<YeePayTopupResult> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SERVER_BASE_URL ?? "http://localhost:3001"}/api/yeepay/topup`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ packageId }),
    },
  );

  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      error.error?.message ?? `创建易支付订单失败 (${res.status})`,
    );
  }

  return (await res.json()) as YeePayTopupResult;
}

/**
 * Poll order status. The frontend polls this every 2-3 seconds
 * after the QR code is displayed until status is 'paid' or 'expired'.
 */
export async function getYeePayOrderStatus(
  accessToken: string,
  outTradeNo: string,
): Promise<YeePayOrderStatus> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SERVER_BASE_URL ?? "http://localhost:3001"}/api/yeepay/orders/${encodeURIComponent(outTradeNo)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!res.ok) {
    throw new Error(`查询订单状态失败 (${res.status})`);
  }

  return (await res.json()) as YeePayOrderStatus;
}

/** @deprecated Use createYeePayTopup */
export const createYeePayOrder = createYeePayTopup;
