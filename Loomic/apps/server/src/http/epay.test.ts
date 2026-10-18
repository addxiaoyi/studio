import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerEpayRoutes } from "./epay.js";
import { buildEpaySign } from "../features/payments/epay-client.js";

const key = "test-md5-key";
const merchantId = "merchant-1";

function makeApp() {
  const activateTopup = vi.fn().mockResolvedValue({ creditsGranted: 100, balance: 100 });
  const getTopupOrder = vi.fn().mockResolvedValue({
    outTradeNo: "order-1",
    amountCnyFen: 10000,
    status: "pending",
  });
  const app = Fastify();
  registerEpayRoutes(app, {
    auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) } as never,
    viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }) } as never,
    creditService: { getTopupOrder, activateTopup } as never,
    baseUrl: "https://pay.example.test",
    merchantId,
    md5Key: key,
    notifyUrl: "https://studio.0st.top/api/epay/notify",
  });
  return { app, activateTopup, getTopupOrder };
}

function signedPayload(overrides: Record<string, string> = {}) {
  const payload = {
    pid: merchantId,
    trade_no: "trade-1",
    out_trade_no: "order-1",
    type: "alipay",
    name: "Topup",
    money: "100.00",
    trade_status: "TRADE_SUCCESS",
    ...overrides,
  };
  return { ...payload, sign: buildEpaySign(payload, key), sign_type: "MD5" };
}

describe("Epay notify", () => {
  it("accepts signed form POST and activates the order once", async () => {
    const { app, activateTopup } = makeApp();
    const payload = signedPayload();
    const response = await app.inject({
      method: "POST",
      url: "/api/epay/notify",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams(payload).toString(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("success");
    expect(activateTopup).toHaveBeenCalledWith("order-1", "trade-1");
  });

  it("accepts signed GET query callbacks", async () => {
    const { app, activateTopup } = makeApp();
    const payload = signedPayload();
    const query = new URLSearchParams(payload).toString();
    const response = await app.inject({ method: "GET", url: `/api/epay/notify?${query}` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("success");
    expect(activateTopup).toHaveBeenCalledOnce();
  });

  it("rejects a valid signature carrying another merchant id", async () => {
    const { app, activateTopup } = makeApp();
    const payload = signedPayload({ pid: "other-merchant" });
    const response = await app.inject({ method: "GET", url: `/api/epay/notify?${new URLSearchParams(payload).toString()}` });
    expect(response.statusCode).toBe(401);
    expect(response.body).toBe("fail");
    expect(activateTopup).not.toHaveBeenCalled();
  });
});
