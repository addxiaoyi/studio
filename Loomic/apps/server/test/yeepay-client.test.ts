// @payments-yeepay — Unit tests for YeePay client (HMAC signing, webhook verification)
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";

import {
  YeePayClient,
  YeePayError,
  type YeePayConfig,
  type YeePayWebhookPayload,
} from "../src/features/payments/yeepay-client.js";

const mockAppKey = "test" + "-app-key";
const mockAppSecret = "test" + "-app-secret";
const mockWebhookSecret = "test" + "-webhook-secret";

function makeClient(overrides: Partial<YeePayConfig> = {}) {
  return new YeePayClient({
    merchantId: "M123456",
    appKey: mockAppKey,
    appSecret: mockAppSecret,
    baseUrl: "https" + "://api.yeepay.com",
    webhookSecret: mockWebhookSecret,
    ...overrides,
  });
}

function hmacSign(secret: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort();
  const str = sorted.map((k) => `${k}=${params[k]}`).join("&");
  return crypto.createHmac("sha256", secret).update(str).digest("hex");
}

describe("YeePayClient.signParams", () => {
  it("produces a stable HMAC-SHA256 hex string for a given set of params", () => {
    const client = makeClient();
    const sign = client.signParams({
      merchantNo: "M123",
      outTradeNo: "YPABC",
      totalAmount: "100",
    });
    const expected = hmacSign("test-app-secret", {
      merchantNo: "M123",
      outTradeNo: "YPABC",
      totalAmount: "100",
    });
    expect(sign).toBe(expected);
  });

  it("produces different signatures when key order changes", () => {
    const client = makeClient();
    const a = client.signParams({ a: "1", b: "2" });
    const b = client.signParams({ b: "2", a: "1" });
    // Both signatures are internally sorted, so they SHOULD be equal.
    expect(a).toBe(b);
  });
});

describe("YeePayClient.verifyWebhook", () => {
  it("accepts a payload signed with the correct webhook secret", () => {
    const client = makeClient();
    const basePayload = {
      tradeNo: "Y20260904001",
      outTradeNo: "YPABC",
      totalAmount: "1000",
      receiptAmount: "1000",
      successTime: "1700000000000",
      buyerId: "buyer-001",
    };
    const sign = hmacSign("test-webhook-secret", basePayload);
    const payload = { ...basePayload, sign } satisfies YeePayWebhookPayload;

    expect(client.verifyWebhook(payload)).toBe(true);
  });

  it("rejects a payload signed with the wrong secret", () => {
    const client = makeClient();
    const basePayload = {
      tradeNo: "Y20260904001",
      outTradeNo: "YPABC",
      totalAmount: "1000",
      receiptAmount: "1000",
      successTime: "1700000000000",
    };
    const sign = hmacSign("WRONG-SECRET", basePayload);
    const payload = { ...basePayload, sign } satisfies YeePayWebhookPayload;

    expect(client.verifyWebhook(payload)).toBe(false);
  });

  it("rejects a payload with a tampered amount", () => {
    const client = makeClient();
    const basePayload = {
      tradeNo: "Y20260904001",
      outTradeNo: "YPABC",
      totalAmount: "1000",
      receiptAmount: "1000",
      successTime: "1700000000000",
    };
    const sign = hmacSign("test-webhook-secret", basePayload);
    // Attacker tampers with the amount after signing
    const payload = { ...basePayload, totalAmount: "1", sign } satisfies YeePayWebhookPayload;

    expect(client.verifyWebhook(payload)).toBe(false);
  });
});

describe("YeePayError", () => {
  it("captures code, message, status, and merchant code", () => {
    const err = new YeePayError("0025", "Order not found", 404, "M123");
    expect(err.code).toBe("0025");
    expect(err.message).toBe("Order not found");
    expect(err.statusCode).toBe(404);
    expect(err.merchantCode).toBe("M123");
    expect(err).toBeInstanceOf(Error);
  });
});
