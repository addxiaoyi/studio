// @payments-yeepay — YeePay (易支付) Native/QR scan pay client
// Docs: https://open.yeepay.com/docs/products/pay-api/native-pay
import crypto from "node:crypto";

// ── Configuration ─────────────────────────────────────────

export type YeePayConfig = {
  merchantId: string;
  /** App Key — used for signing requests */
  appKey: string;
  /** App Secret — used for signing requests (HMAC) */
  appSecret: string;
  /** API base URL */
  baseUrl: string;
  /** Webhook secret (we generate HMAC-SHA256 ourselves) */
  webhookSecret: string;
};

// ── Error types ────────────────────────────────────────────

export class YeePayError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly merchantCode?: string | undefined;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    merchantCode?: string,
  ) {
    super(message);
    this.name = "YeePayError";
    this.code = code;
    this.statusCode = statusCode;
    this.merchantCode = merchantCode;
  }
}

// ── Request/Response types ──────────────────────────────────

export type CreateOrderParams = {
  /** 商户订单号 — must be unique per workspace+plan+period */
  outTradeNo: string;
  /** 订单金额（分） */
  totalAmount: number;
  /** 商品描述 */
  subject: string;
  /** 异步通知地址 */
  notifyUrl: string;
  /** 同步跳转地址 */
  returnUrl?: string;
  /** 商户扩展参数 (JSON string) */
  ext?: Record<string, string>;
};

export type CreateOrderResult = {
  /** 易支付交易流水号 */
  outTradeNo: string;
  /** 易支付商户订单号 */
  tradeNo: string;
  /** 扫码支付二维码链接 (URL, 用户扫码后跳转 H5 收银台) */
  qrCodeUrl: string;
  /** 二维码图片 Base64 (PNG) — alternative to qrCodeUrl */
  qrCodeImage: string;
  /** 订单过期时间 (ms) */
  expiredAt: number;
};

export type QueryOrderResult = {
  outTradeNo: string;
  tradeNo: string;
  status: "SUCCESS" | "FAILED" | "PROCESSING" | "NOT_FOUND";
  totalAmount: number;
  paidAt: number | null;
  buyerId: string | null;
};

export type RefundResult = {
  outTradeNo: string;
  refundTradeNo: string;
  refundAmount: number;
  refundedAt: number;
};

export type YeePayWebhookPayload = {
  /** 易支付交易流水号 */
  tradeNo: string;
  /** 商户订单号 */
  outTradeNo: string;
  /** 订单金额 (分) — 易支付文档约定为字符串 */
  totalAmount: string;
  /** 实付金额 (分) — 易支付文档约定为字符串 */
  receiptAmount: string;
  /** 支付完成时间 (ms) */
  successTime: string;
  /** 买家 ID */
  buyerId?: string;
  /** 签名 */
  sign: string;
  /** 允许其他字段 (YeePay 可能在 webhook 中传额外字段) */
  [key: string]: string | undefined;
};

// ── YeePay client ───────────────────────────────────────────

export class YeePayClient {
  private readonly config: YeePayConfig;

  constructor(config: YeePayConfig) {
    this.config = config;
  }

  /**
   * Generate HMAC-SHA256 signature for YeePay API requests.
   * YeePay signs the request by sorting all params (excluding `sign`),
   * joining key=value pairs with `&`, then signing with appSecret.
   */
  signParams(params: Record<string, string>): string {
    const sortedKeys = Object.keys(params).sort();
    const signString = sortedKeys
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    return crypto
      .createHmac("sha256", this.config.appSecret)
      .update(signString)
      .digest("hex");
  }

  /**
   * Verify webhook signature using webhook secret.
   * Format: sign is computed over the same param serialization
   * but with `sign` field excluded, using webhookSecret.
   */
  verifyWebhook(payload: YeePayWebhookPayload): boolean {
    const { sign, ...rest } = payload;
    const stringParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (typeof v === "string") stringParams[k] = v;
    }
    const expected = this.signWebhookParams(stringParams);
    return crypto.timingSafeEqual(
      Buffer.from(sign, "utf8"),
      Buffer.from(expected, "utf8"),
    );
  }

  private signWebhookParams(params: Record<string, string>): string {
    const sortedKeys = Object.keys(params).sort();
    const signString = sortedKeys
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    return crypto
      .createHmac("sha256", this.config.webhookSecret)
      .update(signString)
      .digest("hex");
  }

  // ── API calls ────────────────────────────────────────────

  /**
   * Create a Native/QR scan pay order.
   * YeePay API: POST /api/v1/orders
   */
  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const path = "/api/v1/orders";
    const body = {
      outTradeNo: params.outTradeNo,
      totalAmount: params.totalAmount.toString(),
      subject: params.subject,
      notifyUrl: params.notifyUrl,
      returnUrl: params.returnUrl ?? "",
      ext: params.ext ? JSON.stringify(params.ext) : "",
    };
    const sign = this.signParams({
      merchantNo: this.config.merchantId,
      ...body,
    });
    const response = await this.post<{
      code: string;
      message: string;
      data?: {
        outTradeNo: string;
        tradeNo: string;
        qrCodeUrl: string;
        qrCodeImage: string;
        expiredTime: number;
      };
    }>(path, {
      merchantNo: this.config.merchantId,
      ...body,
      sign,
    });

    if (response.code !== "0000" || !response.data) {
      throw new YeePayError(
        response.code || "create_order_failed",
        response.message || "Failed to create YeePay order",
        500,
      );
    }

    return {
      outTradeNo: response.data.outTradeNo,
      tradeNo: response.data.tradeNo,
      qrCodeUrl: response.data.qrCodeUrl,
      qrCodeImage: response.data.qrCodeImage,
      expiredAt: response.data.expiredTime,
    };
  }

  /**
   * Query order status by merchant order number.
   * Used to poll payment status after redirect back to success page.
   */
  async queryOrder(outTradeNo: string): Promise<QueryOrderResult> {
    const path = "/api/v1/orders/query";
    const body = {
      merchantNo: this.config.merchantId,
      outTradeNo,
    };
    const sign = this.signParams(body);

    const response = await this.post<{
      code: string;
      message: string;
      data?: {
        outTradeNo: string;
        tradeNo: string;
        status: "SUCCESS" | "FAILED" | "PROCESSING";
        totalAmount: string;
        successTime?: string;
        buyerId?: string;
      };
    }>(path, { ...body, sign });

    if (response.code === "0025") {
      return {
        outTradeNo,
        tradeNo: "",
        status: "NOT_FOUND",
        totalAmount: 0,
        paidAt: null,
        buyerId: null,
      };
    }

    if (response.code !== "0000" || !response.data) {
      throw new YeePayError(
        response.code || "query_order_failed",
        response.message || "Failed to query YeePay order",
        500,
      );
    }

    return {
      outTradeNo: response.data.outTradeNo,
      tradeNo: response.data.tradeNo,
      status: response.data.status,
      totalAmount: Number.parseInt(response.data.totalAmount, 10),
      paidAt: response.data.successTime
        ? Number.parseInt(response.data.successTime, 10)
        : null,
      buyerId: response.data.buyerId ?? null,
    };
  }

  /**
   * Issue a refund for a successful payment.
   */
  async refundOrder(
    outTradeNo: string,
    refundAmount: number,
    reason: string,
  ): Promise<RefundResult> {
    const path = "/api/v1/orders/refund";
    const refundTradeNo = `R${outTradeNo}_${Date.now()}`;
    const body = {
      merchantNo: this.config.merchantId,
      outTradeNo,
      refundTradeNo,
      refundAmount: refundAmount.toString(),
      reason,
    };
    const sign = this.signParams(body);

    const response = await this.post<{
      code: string;
      message: string;
      data?: {
        outTradeNo: string;
        refundTradeNo: string;
        refundAmount: string;
        successTime: string;
      };
    }>(path, { ...body, sign });

    if (response.code !== "0000" || !response.data) {
      throw new YeePayError(
        response.code || "refund_failed",
        response.message || "Failed to refund YeePay order",
        500,
      );
    }

    return {
      outTradeNo: response.data.outTradeNo,
      refundTradeNo: response.data.refundTradeNo,
      refundAmount: Number.parseInt(response.data.refundAmount, 10),
      refundedAt: Number.parseInt(response.data.successTime, 10),
    };
  }

  // ── Low-level HTTP ────────────────────────────────────────

  private async post<T>(path: string, body: Record<string, string>): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(body).toString(),
    });

    if (!response.ok) {
      throw new YeePayError(
        "http_error",
        `YeePay API returned ${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }
}

// ── Factory ──────────────────────────────────────────────────

/**
 * Create a YeePay client from server env. Returns null if required config is missing.
 */
export function createYeePayClient(env: {
  yeepayMerchantId?: string;
  yeepayAppKey?: string;
  yeepayAppSecret?: string;
  yeepayBaseUrl?: string;
  yeepayWebhookSecret?: string;
}): YeePayClient | null {
  if (!env.yeepayMerchantId || !env.yeepayAppKey || !env.yeepayAppSecret) {
    return null;
  }
  return new YeePayClient({
    merchantId: env.yeepayMerchantId,
    appKey: env.yeepayAppKey,
    appSecret: env.yeepayAppSecret,
    baseUrl: env.yeepayBaseUrl ?? "https://api.yeepay.com",
    webhookSecret: env.yeepayWebhookSecret ?? env.yeepayAppSecret,
  });
}
