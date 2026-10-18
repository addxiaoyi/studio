import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerStorageRoutes } from "./storage.js";

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createApp(root: string) {
  const app = Fastify();
  apps.push(app);
  registerStorageRoutes(app, {
    storageProvider: {} as never,
    storageRoot: root,
  });
  await app.ready();
  return app;
}

describe("local storage routes", () => {
  it("serves safe images with hardened headers", async () => {
    const root = await mkdtemp(join(tmpdir(), "helstera-storage-"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "sample.png"), Buffer.from([1, 2, 3]));
    const app = await createApp(root);

    const response = await app.inject({ method: "GET", url: "/api/storage/assets/sample.png" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-site");
  }, 20_000);

  it("forces active content to download", async () => {
    const root = await mkdtemp(join(tmpdir(), "helstera-storage-"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "unsafe.svg"), "<svg><script>alert(1)</script></svg>");
    const app = await createApp(root);

    const response = await app.inject({ method: "GET", url: "/api/storage/assets/unsafe.svg" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toBe('attachment; filename="unsafe.svg"');
    expect(response.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
  });

  it("rejects traversal and invalid bucket names", async () => {
    const root = await mkdtemp(join(tmpdir(), "helstera-storage-"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "secret.txt"), "secret");
    const app = await createApp(root);

    const traversal = await app.inject({ method: "GET", url: "/api/storage/assets/%2e%2e%2fsecret.txt" });
    const invalidBucket = await app.inject({ method: "GET", url: "/api/storage/..%2fassets/sample.png" });

    expect(traversal.statusCode).toBe(404);
    expect(invalidBucket.statusCode).toBe(404);
  });
});
