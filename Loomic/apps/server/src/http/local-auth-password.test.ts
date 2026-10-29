import Fastify from "fastify";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerLocalAuthRoutes } from "./local-auth.js";

const auth = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  hashToken: vi.fn(() => "hashed"),
}));

vi.mock("../local-db/auth.js", () => ({
  exchangeLoginToken: vi.fn(),
  getLocalSession: vi.fn(),
  issueLoginToken: vi.fn(),
  revokeLocalSession: vi.fn(),
  verifyPassword: auth.verifyPassword,
  hashToken: auth.hashToken,
  issueVerificationCode: vi.fn(),
  verifyVerificationCode: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn() },
}));

describe("password sign-in distinguishes a missing password from a wrong one", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.clearAllMocks();
  });

  function createApp(rows: unknown[]) {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith("select id, email, password_hash")) return { rows, rowCount: rows.length };
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as Pool;
    const app = Fastify();
    apps.push(app);
    registerLocalAuthRoutes(app, { db, env: { webOrigin: "https://studio.0st.top" } as never });
    return app;
  }

  function post(app: ReturnType<typeof Fastify>, body: unknown) {
    return app.inject({ method: "POST", url: "/api/local-auth/password", payload: body as never });
  }

  it("reports password_not_set when the account exists without a password hash", async () => {
    const app = createApp([{ id: "u1", email: "code-only@example.com", password_hash: null }]);
    const response = await post(app, { email: "code-only@example.com", password: "whatever1" });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("password_not_set");
    expect(response.json().error.message).toContain("验证码登录");
    expect(auth.verifyPassword).not.toHaveBeenCalled();
  });

  it("keeps invalid_credentials for an unknown account", async () => {
    const app = createApp([]);
    const response = await post(app, { email: "ghost@example.com", password: "whatever1" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("invalid_credentials");
  });

  it("keeps invalid_credentials for a wrong password on a real password account", async () => {
    auth.verifyPassword.mockResolvedValue(false);
    const app = createApp([{ id: "u2", email: "has-pass@example.com", password_hash: "$2b$10$hash" }]);
    const response = await post(app, { email: "has-pass@example.com", password: "wrong-pass" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("invalid_credentials");
    expect(auth.verifyPassword).toHaveBeenCalledWith("wrong-pass", "$2b$10$hash");
  });

  it("signs in when the password matches", async () => {
    auth.verifyPassword.mockResolvedValue(true);
    const app = createApp([{ id: "u3", email: "ok@example.com", password_hash: "$2b$10$hash" }]);
    const response = await post(app, { email: "ok@example.com", password: "right-pass" });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe("ok@example.com");
    expect(response.headers["set-cookie"]).toBeTruthy();
  });
});
