import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ThumbnailCache } from "./thumbnail-cache.js";

it("reuses content thumbnails, evicts old entries under the cap and only clears generated cache files", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-thumbnails-")));
  try {
    const account = randomUUID(), source = join(root, "source.png"); await writeFile(source, "image");
    const render = vi.fn(async () => Buffer.from([255, 216, 1, 2, 3, 4, 5, 6, 255, 217]));
    const cache = new ThumbnailCache(render, { maxBytes: 20, maxFiles: 2, reserveBytes: 0 });
    const input = { root, account, path: source, mime: "image/png", sha256: "1".repeat(64) };
    expect((await cache.get(input)).cached).toBe(false);
    expect((await cache.get(input)).cached).toBe(true); expect(render).toHaveBeenCalledTimes(1);
    await cache.get({ ...input, sha256: "2".repeat(64) }); await cache.get({ ...input, sha256: "3".repeat(64) });
    expect(await cache.usage(root, account)).toMatchObject({ bytes: 20, files: 2, limitBytes: 20 });
    const folder = join(root, "Cache", "Thumbnails"); await writeFile(join(folder, "keep.txt"), "not a cache entry");
    expect(await cache.clear(root, account)).toMatchObject({ files: 2, bytes: 20 });
    expect((await cache.usage(root, account)).files).toBe(0);
    await expect(cache.get({ ...input, account: "../outside" })).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
