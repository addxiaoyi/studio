import Fastify from "fastify";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerLocalAuthRoutes } from "./local-auth.js";

const auth = vi.hoisted(() => ({
  exchangeLoginToken: vi.fn(),
  getLocalSession: vi.fn(),
  issueLoginToken: vi.fn(),
}));

vi.mock("../local-db/auth.js", () => ({
  exchangeLoginToken: auth.exchangeLoginToken,
  getLocalSession: auth.getLocalSession,
  issueLoginToken: auth.issueLoginToken,
  revokeLocalSession: vi.fn(),
  verifyPassword: vi.fn(),
  hashToken: vi.fn(),
  issueVerificationCode: vi.fn(),
  verifyVerificationCode: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn() },
}));

describe("desktop local auth routes", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.clearAllMocks();
  });

  function createApp() {
    const app = Fastify();
    apps.push(app);
    registerLocalAuthRoutes(app, {
      db: {} as Pool,
      env: { webOrigin: "https://studio.0st.top" } as never,
    });
    return app;
  }

  it("requires a signed-in browser session before confirming desktop login", async () => {
    auth.getLocalSession.mockResolvedValue(null);
    const app = createApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/local-auth/desktop-confirm",
      payload: { state: "a".repeat(43) },
    });

    expect(response.statusCode).toBe(401);
    expect(auth.issueLoginToken).not.toHaveBeenCalled();
  });

  it("returns a one-time callback bound to the requested state", async () => {
    auth.getLocalSession.mockResolvedValue({ id: "user-1", email: "user@example.com" });
    auth.issueLoginToken.mockResolvedValue("one-time-token");
    const app = createApp();
    const state = "a".repeat(43);

    const response = await app.inject({
      method: "POST",
      url: "/api/local-auth/desktop-confirm",
      headers: { cookie: "helstera_session=browser-session" },
      payload: { state },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().callbackUrl).toBe(
      `helstera://auth/callback?desktop_token=one-time-token&state=${state}`,
    );
    expect(auth.getLocalSession).toHaveBeenCalledWith(expect.anything(), "browser-session");
    expect(auth.issueLoginToken).toHaveBeenCalledWith(
      expect.anything(),
      "user@example.com",
      3 * 60 * 1000,
    );
  });

  it("accepts only loopback desktop callback URLs", async () => {
    auth.getLocalSession.mockResolvedValue({ id: "user-1", email: "user@example.com" });
    auth.issueLoginToken.mockResolvedValue("one-time-token");
    const app = createApp();
    const state = "a".repeat(43);
    const response = await app.inject({
      method: "POST",
      url: "/api/local-auth/desktop-confirm",
      headers: { cookie: "helstera_session=browser-session" },
      payload: { state, callbackUrl: "http://127.0.0.1:45678/callback" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().callbackUrl).toBe(
      `http://127.0.0.1:45678/callback?desktop_token=one-time-token&state=${state}`,
    );

    const rejected = await app.inject({
      method: "POST",
      url: "/api/local-auth/desktop-confirm",
      headers: { cookie: "helstera_session=browser-session" },
      payload: { state, callbackUrl: "http://192.168.1.5:45678/callback" },
    });
    const wrongProtocolHost = await app.inject({
      method: "POST",
      url: "/api/local-auth/desktop-confirm",
      headers: { cookie: "helstera_session=browser-session" },
      payload: { state, callbackUrl: `helstera://evil/callback` },
    });
    const embeddedState = await app.inject({
      method: "POST",
      url: "/api/local-auth/desktop-confirm",
      headers: { cookie: "helstera_session=browser-session" },
      payload: { state, callbackUrl: `http://127.0.0.1:45678/callback?state=${state}` },
    });
    expect(rejected.statusCode).toBe(400);
    expect(wrongProtocolHost.statusCode).toBe(400);
    expect(embeddedState.statusCode).toBe(400);
    expect(auth.issueLoginToken).toHaveBeenCalledOnce();
  });

  it("exchanges the one-time token and sets the desktop session cookie", async () => {
    auth.exchangeLoginToken.mockResolvedValue({
      token: "desktop-session",
      userId: "user-1",
      email: "user@example.com",
    });
    const app = createApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/local-auth/desktop-exchange",
      payload: { token: "one-time-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, user: { id: "user-1" } });
    expect(response.headers["set-cookie"]).toContain("helstera_session=desktop-session");
    expect(auth.exchangeLoginToken).toHaveBeenCalledWith(
      expect.anything(),
      "one-time-token",
      { allowReplayGrace: false },
    );
  });
});
