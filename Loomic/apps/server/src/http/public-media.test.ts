import { Readable } from "node:stream";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePublicManifest } from "../storage/public-media.js";
import {
  type PublicMediaStore,
  registerPublicMediaRoutes,
} from "./public-media.js";

const hash = "a".repeat(64);
const path = "fashion-gallery/img/SPR-0001.webp";
const entry = {
  key: `loomic-public/${hash}/SPR-0001.webp`,
  sha256: hash,
  bytes: 4,
  mime: "image/webp" as const,
};
const apps: ReturnType<typeof Fastify>[] = [];
function setup(logs?: string[]) {
  const app = Fastify({
    logger: logs
      ? { level: "error", stream: { write: (line: string) => logs.push(line) } }
      : false,
  });
  apps.push(app);
  const read = vi.fn<PublicMediaStore["read"]>(async () => ({
    Body: Readable.from(Buffer.from("webp")) as never,
    ContentLength: 4,
    $metadata: {},
  }));
  registerPublicMediaRoutes(app, {
    manifest: parsePublicManifest({ [path]: entry }),
    read,
    close: vi.fn(),
  });
  return { app, read };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("public Qiniu media boundary", () => {
  it("streams only a verified public manifest entry", async () => {
    const { app, read } = setup();
    const response = await app.inject(`/api/public-media/${path}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("webp");
    expect(response.headers["x-media-storage"]).toBe("qiniu");
    expect(response.headers["content-type"]).toBe("image/webp");
    expect(read.mock.calls[0]?.[0]).toBe(entry.key);
  });
  it.each([
    "private-video/user/file.mp4",
    "private-try-on/photo.webp",
    "fashion-gallery/img/MISSING.webp",
    "database.dump",
  ])("never reads an unpublished key: %s", async (key) => {
    const { app, read } = setup();
    expect((await app.inject(`/api/public-media/${key}`)).statusCode).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects private paths and mismatched hashes in the manifest", () => {
    expect(() =>
      parsePublicManifest({ "private-video/user.mp4": entry }),
    ).toThrow();
    expect(() =>
      parsePublicManifest({ [path]: { ...entry, sha256: "b".repeat(64) } }),
    ).toThrow();
  });
  it("serves conditional requests without an upstream call", async () => {
    const { app, read } = setup();
    expect(
      (
        await app.inject({
          url: `/api/public-media/${path}`,
          headers: { "if-none-match": `"${hash}"` },
        })
      ).statusCode,
    ).toBe(304);
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects multipart ranges and forwards a single range", async () => {
    const { app, read } = setup();
    expect(
      (
        await app.inject({
          url: `/api/public-media/${path}`,
          headers: { range: "bytes=0-1,2-3" },
        })
      ).statusCode,
    ).toBe(416);
    expect(read).not.toHaveBeenCalled();
    read.mockResolvedValueOnce({
      Body: Readable.from(Buffer.from("we")) as never,
      ContentLength: 2,
      ContentRange: "bytes 0-1/4",
      $metadata: {},
    });
    const response = await app.inject({
      url: `/api/public-media/${path}`,
      headers: { range: "bytes=0-1" },
    });
    expect(response.statusCode).toBe(206);
    expect(response.body).toBe("we");
    expect(read.mock.calls[0]?.[1]).toBe("bytes=0-1");
  });
  it("reports upstream failure without exposing signed details", async () => {
    const { app, read } = setup();
    read.mockRejectedValueOnce(new Error("secret signed request"));
    const response = await app.inject(`/api/public-media/${path}`);
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain("secret");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("returns the complete representation when If-Range is stale", async () => {
    const { app, read } = setup();
    const response = await app.inject({
      url: `/api/public-media/${path}`,
      headers: { range: "bytes=2-3", "if-range": '"previous-version"' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("webp");
    expect(read.mock.calls[0]?.[1]).toBeUndefined();
  });

  it.each(["bytes=-2", "bytes=2-", "bytes=2-999"])(
    "normalizes a satisfiable range: %s",
    async (range) => {
      const { app, read } = setup();
      read.mockResolvedValueOnce({
        Body: Readable.from("bp") as never,
        ContentLength: 2,
        ContentRange: "bytes 2-3/4",
        $metadata: {},
      });
      const response = await app.inject({
        url: `/api/public-media/${path}`,
        headers: { range, "if-range": `"${hash}"` },
      });
      expect(response.statusCode).toBe(206);
      expect(response.body).toBe("bp");
      expect(read.mock.calls[0]?.[1]).toBe("bytes=2-3");
    },
  );

  it("keeps upstream credentials out of logs while preserving a safe status", async () => {
    const logs: string[] = [];
    const { app, read } = setup(logs);
    const error = Object.assign(new Error("signed-secret-message"), {
      name: "signed-secret-name",
      $metadata: { httpStatusCode: 403 },
    });
    read.mockRejectedValueOnce(error);
    const response = await app.inject(`/api/public-media/${path}`);
    expect(response.statusCode).toBe(502);
    expect(logs.join(" ")).not.toContain("signed-secret");
    expect(JSON.parse(logs[0] ?? "{}")).toMatchObject({
      kind: "UnknownError",
      status: 403,
    });
  });

  it("handles malformed upstream rejections without throwing another error", async () => {
    const { app, read } = setup();
    read.mockRejectedValueOnce(null);
    const response = await app.inject(`/api/public-media/${path}`);
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("media_unavailable");
  });

  it.each(["bytes=4-", "bytes=3-1", "bytes=-0", "bytes=99999999999999999-"])(
    "rejects an unsatisfiable range before reading storage: %s",
    async (range) => {
      const { app, read } = setup();
      const response = await app.inject({
        url: `/api/public-media/${path}`,
        headers: { range },
      });
      expect(response.statusCode).toBe(416);
      expect(response.headers["content-range"]).toBe("bytes */4");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ContentRange: "bytes 2-3/4", ContentLength: 2 },
    { ContentRange: "bytes 0-1/8", ContentLength: 2 },
    { ContentRange: "bytes 0-1/4", ContentLength: 1 },
    { ContentLength: 2 },
  ])(
    "rejects mismatched upstream partial responses and closes their streams",
    async (metadata) => {
      const { app, read } = setup();
      const body = Readable.from(Buffer.from("we"));
      read.mockResolvedValueOnce({
        Body: body as never,
        ...metadata,
        $metadata: {},
      });
      const response = await app.inject({
        url: `/api/public-media/${path}`,
        headers: { range: "bytes=0-1" },
      });
      expect(response.statusCode).toBe(502);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(body.destroyed).toBe(true);
      expect(read.mock.calls[0]?.[2].aborted).toBe(true);
    },
  );

  it("does not cache capacity rejection and recovers the capacity after requests finish", async () => {
    const { app, read } = setup();
    const pending: Array<
      (object: Awaited<ReturnType<PublicMediaStore["read"]>>) => void
    > = [];
    read.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const requests = Array.from({ length: 24 }, () =>
      Promise.resolve(app.inject(`/api/public-media/${path}`)),
    );
    try {
      await vi.waitFor(() => expect(pending).toHaveLength(24));
      const busy = await app.inject(`/api/public-media/${path}`);
      expect(busy.statusCode).toBe(503);
      expect(busy.headers["cache-control"]).toBe("no-store");
      expect(busy.headers["retry-after"]).toBe("2");
    } finally {
      for (const complete of pending)
        complete({
          Body: Readable.from("webp") as never,
          ContentLength: 4,
          $metadata: {},
        });
      await Promise.all(requests);
    }
    read.mockResolvedValueOnce({
      Body: Readable.from("webp") as never,
      ContentLength: 4,
      $metadata: {},
    });
    expect((await app.inject(`/api/public-media/${path}`)).statusCode).toBe(
      200,
    );
  });
});
