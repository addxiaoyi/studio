import { createHash } from "node:crypto";
import { once } from "node:events";
import { realpathSync } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { PublicMedia } from "./public-media.js";

export function createLocalPublicMedia(
  manifest: Map<string, PublicMedia>,
  root: string,
) {
  const directory = realpathSync(root);
  const objects = new Map(
    [...manifest].map(([path, entry]) => [entry.key, { path, entry }] as const),
  );

  async function read(
    key: string,
    range: string | undefined,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const object = objects.get(key);
    if (!object) throw new Error("Public media is not in the manifest");
    const path = await realpath(resolve(directory, object.path));
    if (!path.startsWith(directory + sep))
      throw new Error("Public media escapes its directory");
    signal.throwIfAborted();
    const file = await open(path, "r");
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size !== object.entry.bytes)
        throw new Error("Public media size differs from the manifest");
      const digest = createHash("sha256");
      signal.throwIfAborted();
      await pipeline(
        file.createReadStream({ start: 0, autoClose: false }),
        async (chunks) => {
          for await (const chunk of chunks) digest.update(chunk);
        },
        { signal },
      );
      if (digest.digest("hex") !== object.entry.sha256)
        throw new Error("Public media hash differs from the manifest");
      signal.throwIfAborted();
      let start = 0;
      let end = info.size - 1;
      if (range) {
        const selected = /^bytes=(\d+)-(\d+)$/.exec(range);
        start = Number(selected?.[1]);
        end = Number(selected?.[2]);
        if (
          !selected ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end < start ||
          end >= info.size
        ) {
          throw Object.assign(new Error("Invalid public media range"), {
            $metadata: { httpStatusCode: 416 },
          });
        }
      }
      signal.throwIfAborted();
      const body = file.createReadStream({
        start,
        end,
        autoClose: true,
        signal,
      });
      // A disconnected caller may not attach a consumer; errors remain observable on the stream.
      body.on("error", (error: NodeJS.ErrnoException) => {
        const wasCancelled = signal.aborted && error.name === "AbortError";
        if (wasCancelled) return;
        console.error("Local public media file stream failed", {
          kind: error.name,
          code: error.code,
        });
      });
      return {
        Body: body,
        ContentLength: end - start + 1,
        ...(range
          ? { ContentRange: `bytes ${start}-${end}/${info.size}` }
          : {}),
      };
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  return {
    storage: "local" as const,
    manifest,
    read,
    probe: async () => {
      const first = manifest.values().next().value;
      if (!first) throw new Error("Public media manifest is empty");
      const object = await read(
        first.key,
        "bytes=0-0",
        AbortSignal.timeout(2000),
      );
      const closed = once(object.Body, "close");
      object.Body.destroy();
      await closed;
    },
    close: () => {},
  };
}
