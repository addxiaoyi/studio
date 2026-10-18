import { createHmac, timingSafeEqual } from "node:crypto";

const PROVIDER_ASSET_TTL_SECONDS = 15 * 60;

export function createProviderAssetUrl(input: {
  origin: string;
  assetId: string;
  secret: string;
  nowMs?: number;
}): string {
  const expiresAt = Math.floor((input.nowMs ?? Date.now()) / 1000) + PROVIDER_ASSET_TTL_SECONDS;
  const signature = signProviderAsset(input.assetId, expiresAt, input.secret);
  const url = new URL(`/api/provider-assets/${encodeURIComponent(input.assetId)}`, input.origin);
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("signature", signature);
  return url.toString();
}

export function verifyProviderAssetSignature(input: {
  assetId: string;
  expiresAt: string;
  signature: string;
  secret: string;
  nowMs?: number;
}): boolean {
  const expiresAt = Number(input.expiresAt);
  if (!Number.isSafeInteger(expiresAt)) return false;
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (expiresAt <= now || expiresAt > now + PROVIDER_ASSET_TTL_SECONDS) return false;
  const expected = Buffer.from(signProviderAsset(input.assetId, expiresAt, input.secret), "hex");
  const actual = Buffer.from(input.signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function signProviderAsset(assetId: string, expiresAt: number, secret: string): string {
  return createHmac("sha256", secret).update(`${assetId}:${expiresAt}`).digest("hex");
}
