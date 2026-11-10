import type { FastifyInstance } from "fastify";
import { healthResponseSchema } from "@helstera/shared";
import type { ServerEnv } from "../config/env.js";

export type ReadinessProbes = { database(): Promise<unknown>; storage(): Promise<unknown>; draining(): boolean };
type Check = { ok: boolean; latencyMs?: number; error?: string };
const PROBE_TIMEOUT_MS = 2500;

function dependencyProbe(probe: () => Promise<unknown>, message: string) {
  let active: Promise<unknown> | undefined;
  return async (): Promise<Check> => {
    const started = performance.now(); let timer: ReturnType<typeof setTimeout> | undefined;
    if (!active) {
      active = Promise.resolve().then(probe).finally(() => { active = undefined; });
      // A timed-out probe stays shared until the underlying operation ends.
      void active.catch(() => undefined);
    }
    try {
      await Promise.race([active, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("probe_timeout")), PROBE_TIMEOUT_MS); })]);
      return { ok: true, latencyMs: Math.round(performance.now() - started) };
    } catch { return { ok: false, latencyMs: Math.round(performance.now() - started), error: message }; }
    finally { clearTimeout(timer); }
  };
}

export async function registerHealthRoutes(app: FastifyInstance, env: ServerEnv, probes?: ReadinessProbes) {
  const missing = async () => { throw new Error("Dependency probes are not installed"); };
  const database = dependencyProbe(probes?.database ?? missing, "数据库连接暂不可用。");
  const storage = dependencyProbe(probes?.storage ?? missing, "存储暂不可写或空间不足。");
  let inFlight: Promise<Record<string, Check>> | undefined;
  app.get("/api/health", async (_request, reply) => reply.header("Cache-Control", "no-store").code(200).send(healthResponseSchema.parse({ ok: true, service: "helstera-server", version: env.version })));
  app.get("/api/health/ready", async (_request, reply) => {
    const draining = probes?.draining() ?? false;
    if (!inFlight) inFlight = (async () => {
      const [db, disk] = await Promise.all([database(), storage()]);
      return { config: { ok: Boolean(env.databaseUrl && env.storageRoot) }, database: db, storage: disk };
    })().finally(() => { inFlight = undefined; });
    const checks = { ...await inFlight, accepting: { ok: !draining && !(probes?.draining() ?? false) } };
    const ok = Object.values(checks).every(check => check.ok);
    return reply.header("Cache-Control", "no-store").code(ok ? 200 : 503).send({ ok, service: "helstera-server", version: env.version, timestamp: new Date().toISOString(), checks });
  });
}
