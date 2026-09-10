import { describe, expect, it } from "vitest";

import {
  buildEpayOrderUrl,
  buildEpaySign,
  verifyEpaySign,
} from "../src/features/payments/epay-client.js";

describe("standard EPay MD5 protocol", () => {
  const params = {
    pid: "1012",
    type: "alipay",
    out_trade_no: "order-1",
    notify_url: "https://studio.example.test/api/epay/notify",
    return_url: "https://studio.example.test/settings?tab=billing",
    name: "标准包",
    money: "200.00",
  };

  it("signs canonical non-empty parameters and verifies the signature", () => {
    const sign = buildEpaySign(params, "test-key");
    expect(sign).toMatch(/^[a-f0-9]{32}$/);
    expect(verifyEpaySign({ ...params, sign }, "test-key")).toBe(true);
    expect(verifyEpaySign({ ...params, sign: `${sign.slice(0, -1)}0` }, "test-key")).toBe(false);
  });

  it("builds a standard mapi.php order URL without making a request", () => {
    const url = buildEpayOrderUrl("https://gateway.example.test/", {
      pid: "1012",
      type: "alipay",
      outTradeNo: "order-1",
      notifyUrl: "https://studio.example.test/api/epay/notify",
      returnUrl: "https://studio.example.test/settings?tab=billing",
      name: "标准包",
      money: "200.00",
    }, "test-key");

    expect(url).toContain("https://gateway.example.test/submit.php?");
    expect(url).toContain("sign_type=MD5");
  });
});
