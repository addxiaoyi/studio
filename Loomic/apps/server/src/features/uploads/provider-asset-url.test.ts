import { describe, expect, it } from "vitest";
import { createProviderAssetUrl, verifyProviderAssetSignature } from "./provider-asset-url.js";

describe("provider asset URL", () => {
  it("signs a short-lived URL scoped to one asset", () => {
    const url = new URL(createProviderAssetUrl({
      origin: "https://studio.example",
      assetId: "asset-1",
      secret: "test-secret",
      nowMs: 1_800_000_000_000,
    }));
    expect(url.pathname).toBe("/api/provider-assets/asset-1");
    expect(verifyProviderAssetSignature({
      assetId: "asset-1",
      expiresAt: url.searchParams.get("expires")!,
      signature: url.searchParams.get("signature")!,
      secret: "test-secret",
      nowMs: 1_800_000_000_000,
    })).toBe(true);
  });

  it("rejects changed ids, changed signatures and expired URLs", () => {
    const url = new URL(createProviderAssetUrl({ origin: "https://studio.example", assetId: "asset-1", secret: "test-secret", nowMs: 1_800_000_000_000 }));
    const input = { assetId: "asset-1", expiresAt: url.searchParams.get("expires")!, signature: url.searchParams.get("signature")!, secret: "test-secret", nowMs: 1_800_000_000_000 };
    expect(verifyProviderAssetSignature({ ...input, assetId: "asset-2" })).toBe(false);
    expect(verifyProviderAssetSignature({ ...input, signature: "0".repeat(64) })).toBe(false);
    expect(verifyProviderAssetSignature({ ...input, nowMs: 1_800_001_000_000 })).toBe(false);
  });
});
