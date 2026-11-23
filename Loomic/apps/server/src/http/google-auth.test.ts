import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GoogleAccountError,
  type GoogleAuthStore,
} from "../local-db/google-auth.js";
import { registerGoogleAuthRoutes, safeGoogleReturnTo } from "./google-auth.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function fixture() {
  const store = {
    saveState: vi.fn(),
    consumeState: vi.fn(),
    signIn: vi.fn(),
    connection: vi.fn().mockResolvedValue(null),
  };
  const exchange = vi.fn().mockResolvedValue({
    subject: "sub",
    email: "user@gmail.com",
    authoritativeEmail: true,
  });
  const client = {
    authorizationUrl: vi.fn(
      ({ state, nonce }) =>
        `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&nonce=${nonce}`,
    ),
    exchange,
  };
  const authenticate = vi.fn().mockResolvedValue(null);
  const app = Fastify();
  apps.push(app);
  registerGoogleAuthRoutes(app, {
    db: {} as never,
    env: { webOrigin: "https://studio.test" } as never,
    auth: { authenticate },
    client,
    store: store as GoogleAuthStore,
  });
  return { app, store, client, authenticate };
}
describe("Google OAuth routes", () => {
  it("binds a fresh authorization to an HttpOnly browser cookie and sanitizes return URLs", async () => {
    const { app, store, client } = fixture();
    const response = await app.inject(
      "/api/local-auth/google/start?returnTo=https://attacker.test",
    );
    expect(response.statusCode).toBe(302);
    expect(response.headers["set-cookie"]).toMatch(
      /__Host-helstera_google=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure/,
    );
    expect(store.saveState).toHaveBeenCalledWith(
      expect.objectContaining({
        returnTo: "/home/",
        state: expect.any(String),
        browser: expect.any(String),
        verifier: expect.any(String),
      }),
    );
    expect(client.authorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
  });
  it("rejects a missing browser cookie before consuming state or contacting Google", async () => {
    const { app, store, client } = fixture();
    const response = await app.inject(
      `/api/local-auth/google/callback?state=${"s".repeat(43)}&code=code`,
    );
    expect(response.headers.location).toContain("google_state_invalid");
    expect(store.consumeState).not.toHaveBeenCalled();
    expect(client.exchange).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {
      nonce_hash: "nonce",
      code_verifier: "verifier",
      return_to: "/home/",
      link_user_id: null,
    },
  ])(
    "handles expired state and cancellation without creating a session",
    async (state) => {
      const { app, store, client } = fixture();
      store.consumeState.mockResolvedValue(state);
      const response = await app.inject({
        url: `/api/local-auth/google/callback?state=${"s".repeat(43)}&error=access_denied`,
        headers: { cookie: `__Host-helstera_google=${"b".repeat(43)}` },
      });
      expect(response.headers.location).toContain(
        state ? "google_canceled" : "google_state_invalid",
      );
      expect(client.exchange).not.toHaveBeenCalled();
      expect(store.signIn).not.toHaveBeenCalled();
    },
  );
  it("sets only the local session cookie after a verified exchange and keeps the return path", async () => {
    const { app, store } = fixture();
    store.consumeState.mockResolvedValue({
      nonce_hash: "nonce-hash",
      code_verifier: "verifier",
      return_to: "/projects/?view=list",
      link_user_id: null,
    });
    store.signIn.mockResolvedValue({
      token: "local-session-token",
      userId: "local-user",
    });
    const response = await app.inject({
      url: `/api/local-auth/google/callback?state=${"s".repeat(43)}&code=private-code`,
      headers: { cookie: `__Host-helstera_google=${"b".repeat(43)}` },
    });
    expect(response.headers.location).toBe("/projects/?view=list");
    expect(String(response.headers["set-cookie"])).toContain(
      "helstera_session=local-session-token",
    );
    expect(response.body).not.toContain("private-code");
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("does not link after the local account changes during Google authorization", async () => {
    const { app, store, client, authenticate } = fixture();
    store.consumeState.mockResolvedValue({
      nonce_hash: "nonce",
      code_verifier: "verifier",
      return_to: "/settings/",
      link_user_id: "original-user",
    });
    authenticate.mockResolvedValue({ id: "another-user" });
    const response = await app.inject({
      url: `/api/local-auth/google/callback?state=${"s".repeat(43)}&code=code`,
      headers: { cookie: `__Host-helstera_google=${"b".repeat(43)}` },
    });
    expect(response.headers.location).toContain("google_link_signin_required");
    expect(client.exchange).not.toHaveBeenCalled();
  });
  it("maps identity conflicts to a safe login error", async () => {
    const { app, store } = fixture();
    store.consumeState.mockResolvedValue({
      nonce_hash: "nonce",
      code_verifier: "verifier",
      return_to: "/home/",
      link_user_id: null,
    });
    store.signIn.mockRejectedValue(
      new GoogleAccountError("google_link_required"),
    );
    const response = await app.inject({
      url: `/api/local-auth/google/callback?state=${"s".repeat(43)}&code=code`,
      headers: { cookie: `__Host-helstera_google=${"b".repeat(43)}` },
    });
    expect(response.headers.location).toContain("google_link_required");
    expect(String(response.headers["set-cookie"])).not.toContain(
      "helstera_session=",
    );
  });
  it("returns a canceled account link to settings with visible feedback", async () => {
    const { app, store } = fixture();
    store.consumeState.mockResolvedValue({
      nonce_hash: "nonce",
      code_verifier: "verifier",
      return_to: "/settings/",
      link_user_id: "user",
    });
    const response = await app.inject({
      url: `/api/local-auth/google/callback?state=${"s".repeat(43)}&error=access_denied`,
      headers: { cookie: `__Host-helstera_google=${"b".repeat(43)}` },
    });
    expect(response.headers.location).toBe(
      "/settings/?tab=profile&google=google_canceled",
    );
    expect(store.signIn).not.toHaveBeenCalled();
  });
  it("does not expose token exchange errors or create a session on failure", async () => {
    const { app, store, client } = fixture();
    store.consumeState.mockResolvedValue({
      nonce_hash: "nonce",
      code_verifier: "verifier",
      return_to: "/home/",
      link_user_id: null,
    });
    client.exchange.mockRejectedValue(
      new Error("private-token-exchange-details"),
    );
    const response = await app.inject({
      url: `/api/local-auth/google/callback?state=${"s".repeat(43)}&code=code`,
      headers: { cookie: `__Host-helstera_google=${"b".repeat(43)}` },
    });
    expect(response.headers.location).toBe("/login/?error=google_failed");
    expect(response.body).not.toContain("private-token-exchange-details");
    expect(store.signIn).not.toHaveBeenCalled();
  });
  it.each([
    "//attacker.test",
    "/\\attacker.test",
    "https://attacker.test",
    "/\nLocation:evil",
  ])("rejects unsafe return target %s", (value) => {
    expect(safeGoogleReturnTo(value, "https://studio.test")).toBe("/home/");
  });
});
