import { describe, expect, it } from "vitest";

import { loadServerEnv } from "../src/config/env.js";

describe("payment gateway configuration", () => {
  it("reads the EPay MD5 configuration without enabling a provider", () => {
    const env = loadServerEnv(
      {},
      {
        EPAY_BASE_URL: "https://gateway.example.test",
        EPAY_MERCHANT_ID: "merchant-test",
        EPAY_MD5_KEY: "not-a-real-key",
        EPAY_SIGN_TYPE: "MD5",
        HELSTERA_WEB_ORIGIN: "https://studio.example.test",
      },
    );

    expect(env.epayBaseUrl).toBe("https://gateway.example.test");
    expect(env.epayMerchantId).toBe("merchant-test");
    expect(env.epayMd5Key).toBe("not-a-real-key");
    expect(env.epaySignType).toBe("MD5");
  });

  it("reads RSA mode without requiring private key material", () => {
    const env = loadServerEnv(
      {},
      { EPAY_SIGN_TYPE: "RSA", HELSTERA_WEB_ORIGIN: "https://studio.example.test" },
    );

    expect(env.epaySignType).toBe("RSA");
    expect(env.epayPrivateKey).toBeUndefined();
  });
});
