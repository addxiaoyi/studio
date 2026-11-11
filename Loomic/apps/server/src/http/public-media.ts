import type { FastifyInstance } from "fastify";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import type { PublicMedia } from "../storage/public-media.js";

export type PublicMediaStore = {
  manifest: Map<string, PublicMedia>;
  read: (key: string, range: string | undefined, signal: AbortSignal) => Promise<GetObjectCommandOutput>;
  close: () => void;
};

export function registerPublicMediaRoutes(app: FastifyInstance, store: PublicMediaStore | undefined) {
  let active = 0;
  if (store) app.addHook("onClose", async () => store.close());
  app.get<{ Params: { "*": string } }>("/api/public-media/*", async (request, reply) => {
    const entry = store?.manifest.get(request.params["*"]);
    if (!entry || !store) return reply.code(404).send({ error: { code: "not_found", message: "Public media not found." } });
    const etag = `"${entry.sha256}"`;
    reply.header("ETag", etag).header("X-Content-Type-Options", "nosniff").header("Cache-Control", "public, max-age=3600").header("X-Media-Storage", "qiniu");
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    const range = request.headers.range;
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return reply.header("Content-Range", `bytes */${entry.bytes}`).code(416).send();
    if (active >= 24) return reply.header("Retry-After", "2").code(503).send({ error: { code: "busy", message: "Media service is busy." } });
    active += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true; active -= 1; clearTimeout(timer); controller.abort();
    };
    reply.raw.once("close", release);
    reply.raw.once("finish", release);
    try {
      const object = await store.read(entry.key, range, controller.signal);
      if (!object.Body || (!range && object.ContentLength !== entry.bytes)) throw new Error("Public media size differs from verified manifest");
      reply.header("Content-Type", entry.mime).header("Accept-Ranges", "bytes");
      if (object.ContentLength !== undefined) reply.header("Content-Length", object.ContentLength);
      if (object.ContentRange) reply.code(206).header("Content-Range", object.ContentRange);
      return reply.send(object.Body);
    } catch (error) {
      release();
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 416) return reply.header("Content-Range", `bytes */${entry.bytes}`).code(416).send();
      // SDK errors can contain signed request details, so log only a bounded error name.
      request.log.error({ kind: error instanceof Error ? error.name : "UnknownError" }, "public media read failed");
      return reply.header("Cache-Control", "no-store").code(502).send({ error: { code: "media_unavailable", message: "Public media is temporarily unavailable." } });
    }
  });
}
