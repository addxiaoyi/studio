import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { afterEach, expect, it } from "vitest";
import type { ServerEnv } from "../config/env.js";
import { createPublicMediaApp } from "../public-media-server.js";
import { loadPublicMedia } from "../storage/public-media.js";
import { registerHealthRoutes } from "./health.js";
import { registerPublicMediaRoutes } from "./public-media.js";

const folders: string[] = [];
const apps: ReturnType<typeof Fastify>[] = [];
const mediaPath = "fashion-gallery/img/SPR-0001.webp";
const bytes = Buffer.from("verified-public-media");
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const folder of folders.splice(0))
    await rm(folder, { recursive: true, force: true });
});

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "loomic-public-local-"));
  folders.push(folder);
  const root = join(folder, "public");
  const file = join(root, mediaPath);
  const manifest = join(folder, "manifest.json");
  await mkdir(join(root, "fashion-gallery/img"), { recursive: true });
  await writeFile(file, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const entry = {
    key: `loomic-public/${sha256}/SPR-0001.webp`,
    sha256,
    bytes: bytes.length,
    mime: "image/webp",
  };
  await writeFile(manifest, JSON.stringify({ [mediaPath]: entry }));
  const store = loadPublicMedia({
    PUBLIC_MEDIA_MANIFEST: manifest,
    PUBLIC_MEDIA_LOCAL_ROOT: root,
  });
  if (!store) throw new Error("Local public media store was not loaded");
  const app = Fastify();
  apps.push(app);
  registerPublicMediaRoutes(app, store);
  await registerHealthRoutes(
    app,
    {
      databaseUrl: "postgres://localhost/test",
      storageRoot: root,
      version: "test",
    } as ServerEnv,
    {
      database: async () => undefined,
      storage: async () => undefined,
      draining: () => false,
      publicMedia: store.probe,
    },
  );
  return { app, root, folder, file, store, entry };
}

it("serves only a hash-verified public file and reports a ready local dependency", async () => {
  const { app, entry } = await fixture();
  const response = await app.inject(`/api/public-media/${mediaPath}`);
  expect(response.statusCode).toBe(200);
  expect(response.rawPayload).toEqual(bytes);
  expect(response.headers["x-media-storage"]).toBe("local");
  expect(response.headers.etag).toBe(`"${entry.sha256}"`);
  const ready = await app.inject("/api/health/ready");
  expect(ready.statusCode).toBe(200);
  expect(ready.json().checks.publicMedia.ok).toBe(true);
});

it("preserves byte ranges, If-Range and 416 responses", async () => {
  const { app, entry } = await fixture();
  const range = await app.inject({
    url: `/api/public-media/${mediaPath}`,
    headers: { range: "bytes=1-3", "if-range": `"${entry.sha256}"` },
  });
  expect(range.statusCode).toBe(206);
  expect(range.rawPayload).toEqual(bytes.subarray(1, 4));
  expect(range.headers["content-range"]).toBe(`bytes 1-3/${bytes.length}`);
  const full = await app.inject({
    url: `/api/public-media/${mediaPath}`,
    headers: { range: "bytes=1-3", "if-range": '"stale"' },
  });
  expect(full.statusCode).toBe(200);
  expect(full.rawPayload).toEqual(bytes);
  expect(
    (
      await app.inject({
        url: `/api/public-media/${mediaPath}`,
        headers: { range: "bytes=999-" },
      })
    ).statusCode,
  ).toBe(416);
});

it("does not publish private files merely because they exist under the configured root", async () => {
  const { app, root } = await fixture();
  await mkdir(join(root, "private-video"));
  await writeFile(join(root, "private-video/secret.mp4"), "private");
  expect(
    (await app.inject("/api/public-media/private-video/secret.mp4")).statusCode,
  ).toBe(404);
});

it("rejects same-length corruption and makes readiness fail", async () => {
  const { app, file } = await fixture();
  await writeFile(file, Buffer.alloc(bytes.length, 120));
  const response = await app.inject(`/api/public-media/${mediaPath}`);
  expect(response.statusCode).toBe(502);
  expect(response.body).not.toContain(file);
  expect((await app.inject("/api/health/ready")).statusCode).toBe(503);
});

it("does not serve a manifest entry whose file disappeared", async () => {
  const { app, file } = await fixture();
  await unlink(file);
  expect((await app.inject(`/api/public-media/${mediaPath}`)).statusCode).toBe(
    502,
  );
  expect((await app.inject("/api/health/ready")).statusCode).toBe(503);
});

it("rejects a symlink that takes a public path outside the configured directory", async () => {
  const { app, root, folder } = await fixture();
  const outside = join(folder, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "SPR-0001.webp"), bytes);
  await rm(join(root, "fashion-gallery/img"), { recursive: true });
  await symlink(outside, join(root, "fashion-gallery/img"), "junction");
  expect((await app.inject(`/api/public-media/${mediaPath}`)).statusCode).toBe(
    502,
  );
});

it("honors an already aborted read", async () => {
  const { store, entry } = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    store.read(entry.key, undefined, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it.each(["during-open", "after-exposure", "stream-failure"])(
  "owns local stream errors without terminating the process: %s",
  async (phase) => {
    const { root, folder, entry } = await fixture();
    const moduleUrl = new URL("../storage/public-media.ts", import.meta.url);
    const program = `
      import assert from "node:assert/strict";
      import { setTimeout } from "node:timers/promises";
      import { loadPublicMedia } from ${JSON.stringify(moduleUrl.href)};
      const store = loadPublicMedia({
        PUBLIC_MEDIA_LOCAL_ROOT: ${JSON.stringify(root)},
        PUBLIC_MEDIA_MANIFEST: ${JSON.stringify(join(folder, "manifest.json"))},
      });
      const controller = new AbortController();
      const pending = store.read(${JSON.stringify(entry.key)}, undefined, controller.signal);
      if (${JSON.stringify(phase)} === "during-open") {
        controller.abort();
        await assert.rejects(pending, { name: "AbortError" });
      } else {
        const { Body } = await pending;
        if (${JSON.stringify(phase)} === "stream-failure") {
          Body.destroy(new Error("storage read failed"));
        } else {
          controller.abort();
        }
        // The route may be disconnected before it attaches its stream listeners.
        await setTimeout(30);
        await assert.rejects(async () => {
          for await (const chunk of Body) assert.fail("Cancelled bytes were exposed");
        }, ${JSON.stringify(phase)} === "stream-failure" ? /storage read failed/ : { name: "AbortError" });
        assert.equal(Body.closed, true);
        assert.equal(Body.fd, null);
      }
      await setTimeout(30);
      console.log("stream-error-owned");
    `;
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", program],
      {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain("stream-error-owned");
    if (phase === "stream-failure")
      expect(child.stderr).toContain("Local public media file stream failed");
  },
);

it("uses the legacy manifest when the generic manifest setting is empty", async () => {
  const { root, folder, entry } = await fixture();
  const store = loadPublicMedia({
    PUBLIC_MEDIA_MANIFEST: "",
    QINIU_PUBLIC_MANIFEST: join(folder, "manifest.json"),
    PUBLIC_MEDIA_LOCAL_ROOT: root,
  });
  expect(store?.manifest.get(mediaPath)).toEqual(entry);
  if (!store) throw new Error("Legacy public media manifest was not loaded");
  await store.probe();
});

it("prefers an explicit generic manifest over the legacy manifest setting", async () => {
  const { root, folder, entry } = await fixture();
  const store = loadPublicMedia({
    PUBLIC_MEDIA_MANIFEST: join(folder, "manifest.json"),
    QINIU_PUBLIC_MANIFEST: join(folder, "missing-legacy.json"),
    PUBLIC_MEDIA_LOCAL_ROOT: root,
  });
  expect(store?.manifest.get(mediaPath)).toEqual(entry);
  if (!store) throw new Error("Explicit public media manifest was not loaded");
  await store.probe();
});

it("fails startup when local mode is configured without a manifest", () => {
  expect(() => loadPublicMedia({ PUBLIC_MEDIA_LOCAL_ROOT: "missing" })).toThrow(
    /manifest/i,
  );
});

it("runs the standalone recovery service with only public media routes", async () => {
  const { root, folder } = await fixture();
  const app = createPublicMediaApp({
    PUBLIC_MEDIA_LOCAL_ROOT: root,
    PUBLIC_MEDIA_MANIFEST: join(folder, "manifest.json"),
    PUBLIC_MEDIA_RELEASE: "recovery-test",
  });
  apps.push(app);
  const ready = await app.inject("/api/health/ready");
  expect(ready.statusCode).toBe(200);
  expect(ready.json()).toMatchObject({
    service: "helstera-public-media",
    version: "recovery-test",
    checks: { publicMedia: { ok: true } },
  });
  expect(
    (await app.inject(`/api/public-media/${mediaPath}`)).rawPayload,
  ).toEqual(bytes);
  expect((await app.inject("/api/uploads/private/file")).statusCode).toBe(404);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/public-media/${mediaPath}`,
      })
    ).statusCode,
  ).toBe(404);
});

it("refuses to start a recovery service without explicit local mode", () => {
  expect(() => createPublicMediaApp({})).toThrow(/local root/);
});
