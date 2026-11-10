import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Reuse the deployment's encryption key across workers, with a separate signing domain.
const secret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY || randomBytes(32);
const lifetime = 5 * 60;
const cookieName = "helstera_media";
const signature = (value: string) => createHmac("sha256", secret).update("private-media-v1:").update(value).digest("base64url");

export function mediaCookie(assetId: string, userId: string, secure: boolean, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ assetId, userId, expires: now + lifetime * 1000 })).toString("base64url");
  return `${cookieName}=${payload}.${signature(payload)}; Path=/api/uploads/${assetId}/file; Max-Age=${lifetime}; HttpOnly; ${secure ? "Secure; SameSite=None" : "SameSite=Lax"}`;
}

export function mediaCookieOwner(cookie: string | undefined, assetId: string, now = Date.now()): string | null {
  for (const pair of cookie?.split(";") ?? []) {
    const [name, token] = pair.trim().split("=");
    if (name !== cookieName || !token || token.length > 1000) continue;
    const [payload, mac] = token.split(".");
    if (!payload || !mac) continue;
    const expected = Buffer.from(signature(payload)), provided = Buffer.from(mac);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) continue;
    try {
      const grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (grant.assetId === assetId && typeof grant.userId === "string" && Number.isFinite(grant.expires) && grant.expires > now) return grant.userId;
    } catch { continue; }
  }
  return null;
}
