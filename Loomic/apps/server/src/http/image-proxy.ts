import type { FastifyInstance } from "fastify";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/avif", "image/gif", "image/jpeg", "image/png", "image/webp",
]);

export function registerImageProxyRoute(app: FastifyInstance) {
  const allowedHosts = buildAllowedHosts();

  app.get<{ Querystring: { url?: string } }>("/api/proxy-image", async (request, reply) => {
    const sourceUrl = request.query.url;
    if (!sourceUrl) return reply.code(400).send({ error: "Missing url parameter" });

    let currentUrl: URL;
    try {
      currentUrl = validateProxyUrl(sourceUrl, allowedHosts);
    } catch {
      return reply.code(403).send({ error: "Image URL is not allowed" });
    }

    try {
      for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        const response = await fetch(currentUrl, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || redirect === MAX_REDIRECTS) throw new Error("Unsafe redirect");
          currentUrl = validateProxyUrl(new URL(location, currentUrl).toString(), allowedHosts);
          continue;
        }
        if (!response.ok) return reply.code(502).send({ error: "Upstream image request failed" });

        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
          return reply.code(415).send({ error: "Upstream response is not a supported image" });
        }
        const declaredLength = Number(response.headers.get("content-length") ?? "0");
        if (declaredLength > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "Image is too large" });

        const buffer = await readLimitedBody(response, MAX_IMAGE_BYTES);
        return reply.header("content-type", contentType)
          .header("content-length", String(buffer.length))
          .header("cache-control", "public, max-age=86400")
          .header("content-security-policy", "default-src 'none'; sandbox")
          .header("x-content-type-options", "nosniff")
          .send(buffer);
      }
    } catch (error) {
      request.log.warn({ error, origin: currentUrl.origin }, "Image proxy request failed");
    }
    return reply.code(502).send({ error: "Failed to fetch image" });
  });
}

export function validateProxyUrl(value: string, allowedHosts: ReadonlySet<string>): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Unsafe image URL");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const allowed = [...allowedHosts].some((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (!allowed) throw new Error("Host is not allowed");
  return url;
}

function buildAllowedHosts(): Set<string> {
  return new Set(["replicate.delivery", "replicate.com"]);
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error("Image is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}
