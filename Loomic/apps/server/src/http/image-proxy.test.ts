import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { registerImageProxyRoute, validateProxyUrl } from "./image-proxy.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("accepts exact hosts and their subdomains", () => {
  const hosts = new Set(["replicate.delivery"]);
  expect(validateProxyUrl("https://replicate.delivery/image.png", hosts).hostname).toBe("replicate.delivery");
  expect(validateProxyUrl("https://pbxt.replicate.delivery/image.png", hosts).hostname).toBe("pbxt.replicate.delivery");
});

it("rejects suffix confusion, credentials, and non-HTTPS URLs", () => {
  const hosts = new Set(["replicate.delivery"]);
  expect(() => validateProxyUrl("https://evilreplicate.delivery/image.png", hosts)).toThrow();
  expect(() => validateProxyUrl("https://user:pass@replicate.delivery/image.png", hosts)).toThrow();
  expect(() => validateProxyUrl("http://replicate.delivery/image.png", hosts)).toThrow();
});

it("rejects redirects outside the allowlist", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://example.com/private" } })));
  const app = Fastify();
  registerImageProxyRoute(app);
  await app.ready();
  const reply = await app.inject({ method: "GET", url: "/api/proxy-image?url=https%3A%2F%2Freplicate.delivery%2Fimage.png" });
  expect(reply.statusCode).toBe(502);
  await app.close();
}, 20_000);

it("returns only supported images with defensive headers", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.from("png"), { status: 200, headers: { "content-type": "image/png" } })));
  const app = Fastify();
  registerImageProxyRoute(app);
  await app.ready();
  const reply = await app.inject({ method: "GET", url: "/api/proxy-image?url=https%3A%2F%2Freplicate.delivery%2Fimage.png" });
  expect(reply.statusCode).toBe(200);
  expect(reply.headers["x-content-type-options"]).toBe("nosniff");
  expect(reply.headers["content-security-policy"]).toContain("sandbox");
  await app.close();
});
