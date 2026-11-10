import { bootstrap } from "global-agent";

// Enable HTTP proxy for all outbound requests if http_proxy / https_proxy is set
bootstrap();

// Native fetch() proxy — needed for @google/generative-ai SDK
if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.GLOBAL_AGENT_HTTP_PROXY));
}

import { buildApp } from "./app.js";
import { loadServerEnv } from "./config/env.js";
import { ServiceLifecycle } from "./runtime/lifecycle.js";

const env = loadServerEnv();
const lifecycle = new ServiceLifecycle();
const app = buildApp({
  env,
  lifecycle,
  autoSyncOfficialPrices: true,
});

const host = process.env.HOST ?? "127.0.0.1";
let stopping: Promise<void> | undefined;
const stop = () => {
  stopping ??= (async () => {
    await lifecycle.drain();
    await app.close();
  })().catch(error => { app.log.error(error, "Graceful shutdown failed"); process.exitCode = 1; });
};
process.once("SIGTERM", stop); process.once("SIGINT", stop);

try {
  await app.listen({
    host,
    port: env.port,
  });

  console.log(`@helstera/server listening on http://${host}:${env.port}`);
  const readiness = await app.inject("/api/health/ready");
  if (readiness.statusCode !== 200) throw new Error("Server dependencies are not ready");
  process.send?.("ready");
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
