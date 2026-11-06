import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { registerOneTakeRoutes } from "./onetake.js";

afterEach(() => vi.unstubAllEnvs());

it("rejects disabled models at the execution boundary before probing or uploading", async () => {
  vi.stubEnv("HELSTERA_ONETAKE_MODELS", "tiny,base");
  const app = Fastify();
  const query = vi.fn(() => { throw new Error("A rejected model must not reach the database"); });
  const probe = vi.fn(async () => ({ available: true, burnSubtitles: true, reason: "" }));
  registerOneTakeRoutes(app, {
    auth: { authenticate: async () => ({ id: randomUUID(), email: "onetake-test@example.invalid" }) },
    db: { query }, storageRoot: "unused", storage: {}, viewerService: {}, probe,
  } as unknown as Parameters<typeof registerOneTakeRoutes>[1]);
  try {
    const denied = await app.inject({ method: "POST", url: "/api/video/onetake/tasks?consent=1&model=large-v3&language=zh", headers: { "idempotency-key": randomUUID() } });
    expect(denied.statusCode).toBe(400);
    expect(denied.json().ok).toBe(false);
    expect(probe).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    const capabilities = await app.inject("/api/video/onetake/capabilities");
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json().models).toEqual(["tiny", "base"]);
  } finally { await app.close(); }
});
