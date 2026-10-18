import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function getKey(): Buffer {
  const value = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  if (!value) throw new Error("Provider encryption key is not configured");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("Provider encryption key must be base64 encoded 32 bytes");
  return key;
}

export function sealModelSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function openModelSecret(value: string): string {
  const packed = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
}
