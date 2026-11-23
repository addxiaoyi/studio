import Fastify from "fastify";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerLocalContactSalesRoutes } from "./local-contact-sales.js";

afterEach(() => vi.unstubAllEnvs());

async function fixture(role: "admin" | "member" | null) {
  vi.stubEnv("SLACK_WEBHOOK_URL", "");
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("system_role")) return { rows: [{ system_role: role }] };
    if (sql.startsWith("insert")) return { rows: [{ id: "inquiry-1" }] };
    return { rows: [{ id: "inquiry-1", message: "Private inquiry" }] };
  });
  const auth = { authenticate: async () => role ? { id: "user-1", email: "user@example.test", accessToken: "test", userMetadata: {} } : null };
  const app = Fastify();
  await registerLocalContactSalesRoutes(app, { db: { query } as unknown as Pool, auth });
  return { app, query };
}

describe("local contact inquiry privacy", () => {
  it.each([null, "member"] as const)("denies inquiry listing for %s before reading messages", async role => {
    const f = await fixture(role);
    try {
      const response = await f.app.inject({ method: "GET", url: "/api/contact-sales/inquiries" });
      expect(response.statusCode).toBe(role ? 403 : 401);
      expect(f.query.mock.calls.some(([sql]) => sql.includes("from contact_inquiries"))).toBe(false);
    } finally { await f.app.close(); }
  });

  it("allows a system administrator to read inquiries without caching", async () => {
    const f = await fixture("admin");
    try {
      const response = await f.app.inject({ method: "GET", url: "/api/contact-sales/inquiries" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.json().inquiries).toHaveLength(1);
    } finally { await f.app.close(); }
  });

  it("persists a public request and returns its reference without a response-time promise", async () => {
    const f = await fixture(null);
    try {
      const response = await f.app.inject({ method: "POST", url: "/api/contact-sales",
        payload: { name: "Launch test", email: "launch@example.test", message: "Please check this isolated release inquiry." } });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ success: true, id: "inquiry-1" });
      expect(response.json().message).not.toContain("24");
    } finally { await f.app.close(); }
  });
});
