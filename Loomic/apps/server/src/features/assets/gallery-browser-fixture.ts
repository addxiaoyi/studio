import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import Fastify from "fastify";
import { Pool } from "pg";
import sharp from "sharp";
import type {
  AuthenticatedUser,
  RequestAuthenticator,
} from "../../auth/types.js";
import { registerGalleryMediaRoutes } from "../../http/gallery-media.js";
import { registerGalleryRoutes } from "../../http/gallery-routes.js";
import { registerLocalAssetRoutes } from "../../http/local-assets.js";
import { registerLocalGrowthRoutes } from "../../http/local-growth.js";
import { createLocalViewerService } from "../../local-db/viewer-service.js";

const run = promisify(execFile);
const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};

export async function createGalleryBrowserFixture(
  databaseUrl: string,
  staticRoot: string,
) {
  if (new URL(databaseUrl).hostname !== "127.0.0.1") {
    throw new Error("Gallery browser tests require loopback PostgreSQL.");
  }
  const web = await realpath(staticRoot);
  if (!(await stat(join(web, "gallery/index.html"))).isFile()) {
    throw new Error(
      "Build the Gallery page before its browser acceptance test.",
    );
  }
  const schema = `gallery_browser_${randomUUID().replaceAll("-", "")}`;
  const folder = await mkdtemp(join(tmpdir(), "helstera-gallery-browser-"));
  const storage = join(folder, "storage");
  const admin = new Pool({ connectionString: databaseUrl });
  const db = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema},public`,
  });
  const app = Fastify();
  const owner: AuthenticatedUser = {
    id: randomUUID(),
    email: "owner@gallery-browser.test",
    accessToken: randomBytes(24).toString("hex"),
    userMetadata: {},
  };
  const peer: AuthenticatedUser = {
    id: randomUUID(),
    email: "peer@gallery-browser.test",
    accessToken: randomBytes(24).toString("hex"),
    userMetadata: {},
  };
  let failNextList = false;
  let schemaCreated = false;
  const close = async () => {
    const failures: unknown[] = [];
    for (const action of [
      () => app.close(),
      () => db.end(),
      async () => {
        if (schemaCreated) await admin.query(`drop schema ${schema} cascade`);
      },
      () => admin.end(),
      () => rm(folder, { recursive: true, force: true }),
    ]) {
      try {
        await action();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Gallery browser fixture cleanup failed",
      );
  };
  try {
    await admin.query(`create schema ${schema}`);
    schemaCreated = true;
    const sql = await readFile(
      new URL("../../local-db/schema.sql", import.meta.url),
      "utf8",
    );
    await db.query(sql.replace("create extension if not exists pgcrypto;", ""));
    const viewerService = createLocalViewerService(db);
    const ownerViewer = await viewerService.ensureViewer(owner);
    await viewerService.ensureViewer(peer);
    const workspaceId = ownerViewer.workspace.id;
    const auth: RequestAuthenticator = {
      authenticate: async (request) => {
        const bearer = request.headers.authorization?.replace(/^Bearer /, "");
        const cookie = request.headers.cookie
          ?.split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("gallery_test_session="))
          ?.slice("gallery_test_session=".length);
        return (
          [owner, peer].find(
            (user) => user.accessToken === (bearer ?? cookie),
          ) ?? null
        );
      },
    };
    app.addHook("onRequest", async (request, reply) => {
      if (request.url.split("?")[0] === "/api/gallery" && failNextList) {
        failNextList = false;
        return reply.code(503).send({
          ok: false,
          error: { message: "作品服务暂不可用，请重试。" },
        });
      }
    });
    registerLocalGrowthRoutes(app, { db, auth, viewerService });
    registerGalleryMediaRoutes(app, { db, root: storage });
    await registerLocalAssetRoutes(app, { db, auth, root: storage });
    // Only authentication is a test seam. Publication, authorization SQL and streams are production routes.
    app.get("/api/local-auth/session", async (request) => {
      const user = await auth.authenticate(request);
      return {
        session: user
          ? {
              access_token: user.accessToken,
              user: { id: user.id, email: user.email },
            }
          : null,
      };
    });
    app.get("/api/viewer", async (request, reply) => {
      const user = await auth.authenticate(request);
      return user
        ? viewerService.ensureViewer(user)
        : reply.code(401).send({ error: { code: "unauthorized" } });
    });
    app.get("/api/credits", async (request, reply) => {
      const user = await auth.authenticate(request);
      if (!user)
        return reply.code(401).send({ error: { code: "unauthorized" } });
      const viewer = await viewerService.ensureViewer(user);
      const balance = (
        await db.query<{ balance: string }>(
          "select balance from credit_balances where workspace_id=$1",
          [viewer.workspace.id],
        )
      ).rows[0];
      return {
        balance: Number(balance?.balance ?? 0),
        totalSpent: 0,
        totalToppedUp: 0,
      };
    });
    app.get("/__fixture__/media", async (_request, reply) =>
      reply
        .type("text/html")
        .send(
          "<!doctype html><html lang='en'><title>Published gallery media</title><body><h1>Published gallery media</h1></body></html>",
        ),
    );
    app.get("/*", async (request, reply) => {
      const pathname = new URL(request.url, "http://fixture.invalid").pathname;
      if (pathname.startsWith("/api/"))
        return reply.code(404).send({ error: "Unknown fixture endpoint" });
      try {
        let file = resolve(web, `.${decodeURIComponent(pathname)}`);
        const child = relative(web, file);
        if (isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`))
          return reply.code(404).send();
        if ((await stat(file)).isDirectory()) file = join(file, "index.html");
        const physical = await realpath(file);
        const physicalChild = relative(web, physical);
        if (
          isAbsolute(physicalChild) ||
          physicalChild === ".." ||
          physicalChild.startsWith(`..${sep}`)
        )
          return reply.code(404).send();
        return reply
          .header("Cache-Control", "no-store")
          .type(mimeTypes[extname(physical)] ?? "application/octet-stream")
          .send(createReadStream(physical));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return reply.code(404).send();
        throw error;
      }
    });
    const imageId = randomUUID();
    const videoId = randomUUID();
    const imagePath = `${workspaceId}/${imageId}.png`;
    const videoPath = `${workspaceId}/${videoId}.mp4`;
    await mkdir(join(storage, "private-try-on", workspaceId), {
      recursive: true,
    });
    await mkdir(join(storage, "private-video", workspaceId), {
      recursive: true,
    });
    const imageFile = join(storage, "private-try-on", imagePath);
    const videoFile = join(storage, "private-video", videoPath);
    await sharp({
      create: { width: 320, height: 180, channels: 3, background: "#127a6a" },
    })
      .png()
      .toFile(imageFile);
    await run(
      process.env.HELT_FFMPEG_PATH ?? "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x120:rate=24",
        "-t",
        "2",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        videoFile,
      ],
      { windowsHide: true, timeout: 30_000 },
    );
    for (const asset of [
      {
        id: imageId,
        path: imagePath,
        file: imageFile,
        bucket: "private-try-on",
        mime: "image/png",
        type: "image",
        title: "真实图片作品",
      },
      {
        id: videoId,
        path: videoPath,
        file: videoFile,
        bucket: "private-video",
        mime: "video/mp4",
        type: "video",
        title: "真实视频作品",
      },
    ]) {
      await db.query(
        "insert into asset_objects(id,workspace_id,created_by,bucket,object_path,mime_type,byte_size) values($1,$2,$3,$4,$5,$6,$7)",
        [
          asset.id,
          workspaceId,
          owner.id,
          asset.bucket,
          asset.path,
          asset.mime,
          (await stat(asset.file)).size,
        ],
      );
      await db.query(
        "insert into generated_assets(id,workspace_id,created_by,media_type,object_path,mime_type,title) values($1,$2,$3,$4,$5,$6,$7)",
        [
          asset.id,
          workspaceId,
          owner.id,
          asset.type,
          asset.path,
          asset.mime,
          asset.title,
        ],
      );
    }
    const listen = new URL(await app.listen({ host: "127.0.0.1", port: 3001 }));
    return {
      origin: `http://localhost:${listen.port}`,
      api: listen.origin,
      owner,
      peer,
      imageId,
      videoId,
      imageFile,
      videoFile,
      db,
      close,
      failListOnce() {
        failNextList = true;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
