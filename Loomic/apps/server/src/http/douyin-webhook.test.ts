import { createHash } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerDouyinWebhookRoutes } from "./douyin-webhook.js";

function signature(secret: string, body: string) {
  return createHash("sha1").update(secret).update(body).digest("hex");
}

describe("Douyin webhook", () => {
  it("validates the source signature and echoes the verification challenge", async () => {
    const app = Fastify();
    const db = { query: vi.fn() };
    registerDouyinWebhookRoutes(app, { db: db as never, env: { douyinClientSecret: "secret", douyinClientKey: "client" } as never });
    const raw = JSON.stringify({ event: "verify_webhook", client_key: "client", content: { challenge: 12345 } });
    const response = await app.inject({ method: "POST", url: "/api/integrations/douyin/webhook", headers: { "x-douyin-signature": signature("secret", raw) }, payload: JSON.parse(raw) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ challenge: 12345 });
  });

  it("accepts the unsigned registration handshake without persisting an event", async () => {
    const app = Fastify();
    const db = { query: vi.fn() };
    registerDouyinWebhookRoutes(app, { db: db as never, env: {} as never });
    const response = await app.inject({
      method: "POST",
      url: "/api/integrations/douyin/webhook",
      payload: { event: "verify_webhook", content: { challenge: "probe" } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ challenge: "probe" });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("rejects real events until the server secret is configured", async () => {
    const app = Fastify();
    const db = { query: vi.fn() };
    registerDouyinWebhookRoutes(app, { db: db as never, env: {} as never });
    const response = await app.inject({
      method: "POST",
      url: "/api/integrations/douyin/webhook",
      payload: { event: "video_event", content: {} },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("douyin_webhook_not_configured");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("deduplicates messages by Msg-Id", async () => {
    const app = Fastify();
    const db = { query: vi.fn().mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 }) };
    registerDouyinWebhookRoutes(app, { db: db as never, env: { douyinClientSecret: "secret", douyinClientKey: "client" } as never });
    const raw = JSON.stringify({ event: "video_event", client_key: "client", content: {} });
    const headers = { "x-douyin-signature": signature("secret", raw), "msg-id": "msg-1" };
    const first = await app.inject({ method: "POST", url: "/api/integrations/douyin/webhook", headers, payload: JSON.parse(raw) });
    const second = await app.inject({ method: "POST", url: "/api/integrations/douyin/webhook", headers, payload: JSON.parse(raw) });
    expect(first.json().duplicate).toBe(false);
    expect(second.json().duplicate).toBe(true);
  });
});
