import type { Readable } from "node:stream";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import type { FastifyInstance } from "fastify";
import type { PublicMedia } from "../storage/public-media.js";
import { parseByteRange } from "./media-byte-range.js";

const MAX_ACTIVE_MEDIA_REQUESTS = 24;
const MEDIA_TIMEOUT_MS = 180_000;
const STORAGE_ERROR_NAMES = new Set([
  "AbortError",
  "AccessDenied",
  "AccountProblem",
  "InvalidAccessKeyId",
  "InvalidRange",
  "NoSuchBucket",
  "NoSuchKey",
  "SignatureDoesNotMatch",
  "TimeoutError",
  "NetworkingError",
  "Error",
]);

type PublicMediaRead = Pick<
  GetObjectCommandOutput,
  "ContentLength" | "ContentRange"
> & {
  Body?: GetObjectCommandOutput["Body"] | Readable;
  $metadata?: GetObjectCommandOutput["$metadata"];
};

export type PublicMediaStore = {
  storage?: "qiniu" | "local";
  manifest: Map<string, PublicMedia>;
  read: (
    key: string,
    range: string | undefined,
    signal: AbortSignal,
  ) => Promise<PublicMediaRead>;
  probe?: () => Promise<unknown>;
  close: () => void;
};

export function registerPublicMediaRoutes(
  app: FastifyInstance,
  store: PublicMediaStore | undefined,
) {
  let active = 0;
  if (store) app.addHook("onClose", async () => store.close());
  app.get<{ Params: { "*": string } }>(
    "/api/public-media/*",
    async (request, reply) => {
      const entry = store?.manifest.get(request.params["*"]);
      if (!entry || !store)
        return reply.code(404).send({
          error: { code: "not_found", message: "Public media not found." },
        });
      const etag = `"${entry.sha256}"`;
      reply
        .header("ETag", etag)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "public, max-age=3600")
        .header("X-Media-Storage", store.storage ?? "qiniu");
      if (request.headers["if-none-match"] === etag)
        return reply.code(304).send();
      const range =
        !request.headers["if-range"] || request.headers["if-range"] === etag
          ? request.headers.range
          : undefined;
      const selected = range ? parseByteRange(range, entry.bytes) : null;
      if (range && !selected)
        return reply
          .header("Cache-Control", "no-store")
          .header("Content-Range", `bytes */${entry.bytes}`)
          .code(416)
          .send();
      if (active >= MAX_ACTIVE_MEDIA_REQUESTS)
        return reply
          .header("Cache-Control", "no-store")
          .header("Retry-After", "2")
          .code(503)
          .send({ error: { code: "busy", message: "Media service is busy." } });
      active += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
      let body: PublicMediaRead["Body"];
      let settled = false;
      const release = () => {
        // A rejected or disconnected response must not leave the upstream socket open.
        if (body && "destroy" in body && typeof body.destroy === "function")
          body.destroy();
        if (settled) return;
        settled = true;
        active -= 1;
        clearTimeout(timer);
        controller.abort();
      };
      reply.raw.once("close", release);
      reply.raw.once("finish", release);
      try {
        const upstreamRange = selected
          ? `bytes=${selected.start}-${selected.end}`
          : undefined;
        const object = await store.read(
          entry.key,
          upstreamRange,
          controller.signal,
        );
        body = object.Body;
        controller.signal.throwIfAborted();
        const expectedBytes = selected
          ? selected.end - selected.start + 1
          : entry.bytes;
        const expectedRange = selected
          ? `bytes ${selected.start}-${selected.end}/${entry.bytes}`
          : undefined;
        if (
          !body ||
          object.ContentLength !== expectedBytes ||
          object.ContentRange !== expectedRange
        )
          throw new Error(
            "Public media response differs from verified manifest",
          );
        reply
          .header("Content-Type", entry.mime)
          .header("Accept-Ranges", "bytes");
        if (object.ContentLength !== undefined)
          reply.header("Content-Length", object.ContentLength);
        if (object.ContentRange)
          reply.code(206).header("Content-Range", object.ContentRange);
        return reply.send(body);
      } catch (error) {
        release();
        const status =
          error && typeof error === "object" && "$metadata" in error
            ? (error.$metadata as { httpStatusCode?: number } | undefined)
                ?.httpStatusCode
            : undefined;
        if (status === 416)
          return reply
            .header("Cache-Control", "no-store")
            .header("Content-Range", `bytes */${entry.bytes}`)
            .code(416)
            .send();
        // SDK errors can contain signed request details, including a custom name.
        const kind =
          error instanceof Error && STORAGE_ERROR_NAMES.has(error.name)
            ? error.name
            : "UnknownError";
        request.log.error(
          {
            kind,
            ...(typeof status === "number" && status >= 100 && status <= 599
              ? { status }
              : {}),
          },
          "public media read failed",
        );
        return reply
          .header("Cache-Control", "no-store")
          .code(502)
          .send({
            error: {
              code: "media_unavailable",
              message: "Public media is temporarily unavailable.",
            },
          });
      }
    },
  );
}
