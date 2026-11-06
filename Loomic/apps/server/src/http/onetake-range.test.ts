import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { registerOneTakeRoutes } from "./onetake.js";

it("streams suffix and oversized ranges and honors If-Range", async () => {
  const folder = await mkdtemp(join(tmpdir(), "onetake-range-"));
  const source = join(folder, "video.mp4");
  await writeFile(source, "0123456789");
  const app = Fastify();
  const id = randomUUID();
  registerOneTakeRoutes(app, { auth: { authenticate: async () => ({ id }) }, db: { query: vi.fn(async () => ({ rows: [{ source_path: source, mime_type: "video/mp4", source_name: "video.mp4" }] })) }, storageRoot: folder, storage: {}, viewerService: {} } as unknown as Parameters<typeof registerOneTakeRoutes>[1]);
  try {
    const suffix = await app.inject({ url: `/api/video/onetake/tasks/${id}/source`, headers: { range: "bytes=-4" } });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.body).toBe("6789");
    const oversized = await app.inject({ url: `/api/video/onetake/tasks/${id}/source`, headers: { range: "bytes=7-99" } });
    expect(oversized.statusCode).toBe(206);
    expect(oversized.body).toBe("789");
    const stale = await app.inject({ url: `/api/video/onetake/tasks/${id}/source`, headers: { range: "bytes=0-2", "if-range": '"old"' } });
    expect(stale.statusCode).toBe(200);
    expect(stale.body).toBe("0123456789");
  } finally { await app.close(); await rm(folder, { recursive: true, force: true }); }
});
