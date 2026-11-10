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
    expect((await cache.usage(root, account)).lastCleanup).toMatchObject({ reason: "automatic", files: 1, bytes: 10 });
    const folder = join(root, "Cache", "Thumbnails"); await writeFile(join(folder, "keep.txt"), "not a cache entry");
    expect(await cache.clear(root, account)).toMatchObject({ files: 2, bytes: 20 });
    expect((await cache.usage(root, account)).files).toBe(0);
    await expect(cache.get({ ...input, account: "../outside" })).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("persists cache settings, records automatic eviction and preserves original files when disabled", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "helstera-cache-settings-")));
  try {
    const account = randomUUID(), source = join(root, "original.png"); await writeFile(source, "source");
    const render = vi.fn(async () => Buffer.from([255, 216, 1, 2, 255, 217]));
    const cache = new ThumbnailCache(render);
    await cache.get({ root, account, path: source, mime: "image/png", sha256: "a".repeat(64) });
    await expect(cache.configure(root, account, { capacityMiB: -1 })).rejects.toThrow("容量");
    const disabled = await cache.configure(root, account, { capacityMiB: 0 });
    expect(disabled.limitBytes).toBe(0); expect(disabled.files).toBe(0);
    expect(disabled.lastCleanup).toMatchObject({ reason: "settings", files: 1 });
    await expect(cache.get({ root, account, path: source, mime: "image/png", sha256: "a".repeat(64) })).rejects.toThrow("已关闭");
    const restarted = new ThumbnailCache(render); expect((await restarted.usage(root, account)).limitBytes).toBe(0);
    expect((await restarted.configure(root, account, { capacityMiB: 64 })).limitBytes).toBe(64 * 1024 ** 2);
    expect((await restarted.usage(root, account)).lastCleanup).toEqual(disabled.lastCleanup);
  } finally { await rm(root, { recursive: true, force: true }); }
});
