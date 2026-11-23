import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createGoogleLoginClient,
  validateGoogleIdentity,
} from "./google-identity.js";
const nonceHash = createHash("sha256").update("expected-nonce").digest("hex");
const claims = {
  sub: "google-subject",
  email: "owner@gmail.com",
  email_verified: true,
  nonce: "expected-nonce",
};
describe("Google identity verification", () => {
  it("requires a verified email and the nonce from this browser flow", () => {
    expect(() =>
      validateGoogleIdentity({ ...claims, email_verified: false }, nonceHash),
    ).toThrow();
    expect(() =>
      validateGoogleIdentity({ ...claims, nonce: "different" }, nonceHash),
    ).toThrow();
    expect(() =>
      validateGoogleIdentity({ ...claims, sub: "" }, nonceHash),
    ).toThrow();
    expect(validateGoogleIdentity(claims, nonceHash)).toMatchObject({
      subject: claims.sub,
      authoritativeEmail: true,
    });
  });
  it("does not automatically trust Google's historic verification of an external mailbox", () => {
    expect(
      validateGoogleIdentity(
        { ...claims, email: "member@example.com" },
        nonceHash,
      ).authoritativeEmail,
    ).toBe(false);
    expect(
      validateGoogleIdentity(
        { ...claims, email: "member@example.com", hd: "example.com" },
        nonceHash,
      ).authoritativeEmail,
    ).toBe(true);
    expect(
      validateGoogleIdentity(
        { ...claims, email: "member@example.com", hd: "another.example" },
        nonceHash,
      ).authoritativeEmail,
    ).toBe(false);
  });
  it("uses the fixed callback, PKCE and minimal identity scopes without exposing the secret", () => {
    const client = createGoogleLoginClient({
      webOrigin: "https://studio.test",
      googleOAuthClientId: "fixture.apps.googleusercontent.com",
      googleOAuthClientSecret: "private-fixture",
    });
    if (!client) throw new Error("Configured Google client is missing");
    const url = new URL(
      client.authorizationUrl({
        state: "state",
        nonce: "nonce",
        challenge: "challenge",
      }),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://studio.test/api/local-auth/google/callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("nonce")).toBe("nonce");
    expect(url.href).not.toContain("private-fixture");
  });
});
