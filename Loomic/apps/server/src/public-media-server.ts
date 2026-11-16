import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { registerPublicMediaRoutes } from "./http/public-media.js";
import { loadPublicMedia } from "./storage/public-media.js";

export function createPublicMediaApp(env: NodeJS.ProcessEnv) {
  if (!env.PUBLIC_MEDIA_LOCAL_ROOT)
    throw new Error("Public media recovery requires a local root");
  const store = loadPublicMedia(env);
  if (!store)
    throw new Error("Public media recovery requires a verified manifest");
  const app = Fastify({ logger: { level: "error" } });
  registerPublicMediaRoutes(app, store);
  app.get("/api/health/ready", async (_request, reply) => {
    let ok = false;
    try {
      await store.probe();
      ok = true;
    } catch (error) {
      app.log.error(
        { kind: error instanceof Error ? error.name : "UnknownError" },
        "Public media readiness failed",
      );
    }
    return reply
      .header("Cache-Control", "no-store")
      .code(ok ? 200 : 503)
      .send({
        ok,
        service: "helstera-public-media",
        version: env.PUBLIC_MEDIA_RELEASE ?? "unversioned",
        checks: { publicMedia: { ok } },
      });
  });
  return app;
}

async function startPublicMediaServer() {
  const port = Number(process.env.PUBLIC_MEDIA_PORT ?? "3014");
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid public media port");
  const app = createPublicMediaApp(process.env);
  await app.listen({ host: "127.0.0.1", port });
  let closing: Promise<void> | undefined;
  const stop = () => {
    closing ??= app.close();
    void closing.catch((error) => {
      console.error("Public media shutdown failed", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.log(
    JSON.stringify({
      service: "helstera-public-media",
      state: "ready",
      port,
      pid: process.pid,
    }),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void startPublicMediaServer().catch((error) => {
    console.error("Public media startup failed", error);
    process.exitCode = 1;
  });
}
