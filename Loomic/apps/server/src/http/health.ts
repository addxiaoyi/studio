import { healthResponseSchema } from "@helstera/shared";
import type { FastifyInstance } from "fastify";
import type { CapacityDiagnostics } from "../config/capacity-policy.js";
import type { ServerEnv } from "../config/env.js";

export type ReadinessProbes = {
  database(): Promise<unknown>;
  storage(): Promise<unknown>;
  publicMedia?(): Promise<unknown>;
  draining(): boolean;
};
type Check = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  capacity?: CapacityDiagnostics;
};
const PROBE_TIMEOUT_MS = 2500;

function dependencyProbe(probe: () => Promise<unknown>, message: string) {
  let active: Promise<unknown> | undefined;
  return async (): Promise<Check> => {
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!active) {
      active = Promise.resolve()
        .then(probe)
        .finally(() => {
          active = undefined;
        });
      // A timed-out probe stays shared until the underlying operation ends.
      void active.catch(() => undefined);
    }
    try {
      const value = await Promise.race([
        active,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("probe_timeout")),
            PROBE_TIMEOUT_MS,
          );
        }),
      ]);
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        ...capacityFrom(value),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        error: message,
        ...capacityFrom(error),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

function capacityFrom(
  value: unknown,
): Pick<Check, "capacity"> | Record<string, never> {
  if (!value || typeof value !== "object") return {};
  const candidate = value as {
    capacity?: unknown;
    details?: unknown;
    disks?: unknown;
  };
  const source = candidate.details ?? candidate.capacity ?? candidate;
  if (
    !source ||
    typeof source !== "object" ||
    !Array.isArray((source as { disks?: unknown }).disks)
  )
    return {};
  const disks = (source as { disks: unknown[] }).disks.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const disk = entry as Record<string, unknown>;
    if (
      typeof disk.path !== "string" ||
      !Array.isArray(disk.labels) ||
      !disk.labels.every((label) => typeof label === "string")
    )
      return [];
    if (
      ![disk.availableBytes, disk.requiredBytes, disk.shortageBytes].every(
        (bytes) =>
          typeof bytes === "number" &&
          Number.isSafeInteger(bytes) &&
          bytes >= 0,
      )
    )
      return [];
    return [
      {
        path: disk.path,
        labels: disk.labels as string[],
        availableBytes: disk.availableBytes as number,
        requiredBytes: disk.requiredBytes as number,
        shortageBytes: disk.shortageBytes as number,
      },
    ];
  });
  return disks.length ? { capacity: { disks } } : {};
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  env: ServerEnv,
  probes?: ReadinessProbes,
) {
  const missing = async () => {
    throw new Error("Dependency probes are not installed");
  };
  const database = dependencyProbe(
    probes?.database ?? missing,
    "数据库连接暂不可用。",
  );
  const storage = dependencyProbe(
    probes?.storage ?? missing,
    "存储暂不可写或空间不足。",
  );
  const publicMedia = probes?.publicMedia
    ? dependencyProbe(probes.publicMedia, "公共媒体存储暂不可用。")
    : undefined;
  let inFlight: Promise<Record<string, Check>> | undefined;
  app.get("/api/health", async (_request, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .code(200)
      .send(
        healthResponseSchema.parse({
          ok: true,
          service: "helstera-server",
          version: env.version,
        }),
      ),
  );
  app.get("/api/health/ready", async (_request, reply) => {
    const draining = probes?.draining() ?? false;
    if (!inFlight)
      inFlight = (async () => {
        const [db, disk] = await Promise.all([database(), storage()]);
        const checks: Record<string, Check> = {
          config: { ok: Boolean(env.databaseUrl && env.storageRoot) },
          database: db,
          storage: disk,
        };
        if (publicMedia) checks.publicMedia = await publicMedia();
        return checks;
      })().finally(() => {
        inFlight = undefined;
      });
    const checks = {
      ...(await inFlight),
      accepting: { ok: !draining && !(probes?.draining() ?? false) },
    };
    const ok = Object.values(checks).every((check) => check.ok);
    return reply
      .header("Cache-Control", "no-store")
      .code(ok ? 200 : 503)
      .send({
        ok,
        service: "helstera-server",
        version: env.version,
        timestamp: new Date().toISOString(),
        checks,
      });
  });
}
