import { createHash, timingSafeEqual } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import type { ServerEnv } from "../../config/env.js";

export type GoogleIdentity = {
  subject: string;
  email: string;
  authoritativeEmail: boolean;
  name?: string;
};
export type GoogleLoginClient = {
  authorizationUrl(input: {
    state: string;
    nonce: string;
    challenge: string;
  }): string;
  exchange(
    code: string,
    verifier: string,
    nonceHash: string,
  ): Promise<GoogleIdentity>;
};

export function validateGoogleIdentity(
  claims: Record<string, unknown> | undefined,
  nonceHash: string,
): GoogleIdentity {
  if (
    !claims ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    claims.sub.length > 255 ||
    typeof claims.email !== "string" ||
    claims.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email) ||
    claims.email_verified !== true ||
    typeof claims.nonce !== "string" ||
    !/^[a-f0-9]{64}$/.test(nonceHash)
  ) {
    throw new Error("Google identity claims are incomplete");
  }
  const actual = createHash("sha256").update(claims.nonce).digest();
  if (!timingSafeEqual(actual, Buffer.from(nonceHash, "hex")))
    throw new Error("Google identity nonce mismatch");
  const email = claims.email.toLowerCase();
  const hostedDomain =
    typeof claims.hd === "string" ? claims.hd.toLowerCase() : undefined;
  return {
    subject: claims.sub,
    email,
    // A third-party email verified in the past is not proof of its present owner.
    authoritativeEmail:
      email.endsWith("@gmail.com") ||
      email.endsWith("@googlemail.com") ||
      Boolean(hostedDomain && email.endsWith(`@${hostedDomain}`)),
    ...(typeof claims.name === "string"
      ? { name: claims.name.slice(0, 120) }
      : {}),
  };
}

export function createGoogleLoginClient(
  env: Pick<
    ServerEnv,
    "webOrigin" | "googleOAuthClientId" | "googleOAuthClientSecret"
  >,
): GoogleLoginClient | undefined {
  if (!env.googleOAuthClientId || !env.googleOAuthClientSecret)
    return undefined;
  const clientId = env.googleOAuthClientId;
  const redirectUri = new URL("/api/local-auth/google/callback", env.webOrigin)
    .href;
  const oauth = new OAuth2Client({
    clientId,
    clientSecret: env.googleOAuthClientSecret,
    redirectUri,
    transporterOptions: { timeout: 15_000, retry: false },
  });
  return {
    authorizationUrl({ state, nonce, challenge }) {
      const url = new URL(
        oauth.generateAuthUrl({
          scope: ["openid", "email", "profile"],
          state,
          access_type: "online",
          prompt: "select_account",
          code_challenge: challenge,
          code_challenge_method: CodeChallengeMethod.S256,
        }),
      );
      url.searchParams.set("nonce", nonce);
      return url.href;
    },
    async exchange(code, codeVerifier, nonceHash) {
      const { tokens } = await oauth.getToken({
        code,
        codeVerifier,
        redirect_uri: redirectUri,
      });
      if (!tokens.id_token)
        throw new Error("Google did not return an ID token");
      const ticket = await oauth.verifyIdToken({
        idToken: tokens.id_token,
        audience: clientId,
      });
      return validateGoogleIdentity(
        ticket.getPayload() as unknown as Record<string, unknown> | undefined,
        nonceHash,
      );
    },
  };
}
