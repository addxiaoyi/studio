import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CAPACITY_POLICY } from "../config/capacity-policy.js";
import type { ServerEnv } from "../config/env.js";
import { registerHealthRoutes } from "./health.js";

const env = {
  authProvider: "local",
  capacityPolicy: DEFAULT_CAPACITY_POLICY,
  storageProvider: "local",
  databaseUrl: "postgres://localhost/helstera",
  storageRoot: "/tmp/helstera-uploads",
  systemAdminEmails: [],
  agentBackendMode: "state",
  agentModel: "test-model",
  port: 3204,
  version: "test",
  webOrigin: "http://localhost:3000",
  douyinMcpServerUrl: "http://localhost:0",
  douyinMcpAllowedTools: [],
} as ServerEnv;

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function build(probes: {
  database?: () => Promise<unknown>;
  storage?: () => Promise<unknown>;
  publicMedia?: () => Promise<unknown>;
  draining?: () => boolean;
}) {
  const app = Fastify();
  apps.push(app);
  await registerHealthRoutes(app, env, {
    database: probes.database ?? (async () => undefined),
    storage: probes.storage ?? (async () => undefined),
    ...(probes.publicMedia ? { publicMedia: probes.publicMedia } : {}),
    draining: probes.draining ?? (() => false),
  });
  await app.ready();
  return app;
}

describe("health readiness", () => {
  it("returns 503 when the storage probe fails", async () => {
    const app = await build({
      storage: async () => {
        throw new Error("disk full");
      },
    });

    const response = await app.inject("/api/health/ready");

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.storage.ok).toBe(false);
  });

  it("exposes storage capacity details without leaking unrelated errors", async () => {
    const app = await build({
      storage: async () => ({
        ok: true,
        disks: [
          {
            path: "/media",
            labels: ["media"],
            availableBytes: 9,
            requiredBytes: 10,
            shortageBytes: 1,
          },
        ],
      }),
    });

    const response = await app.inject("/api/health/ready");

    expect(response.statusCode).toBe(200);
    expect(response.json().checks.storage.capacity.disks[0]).toMatchObject({
      path: "/media",
      availableBytes: 9,
      requiredBytes: 10,
      shortageBytes: 1,
    });
  });

  it("shares one dependency probe across concurrent readiness requests", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = await build({
      database: vi.fn(async () => {
        calls += 1;
        await gate;
      }),
    });

    const first = app.inject("/api/health/ready");
    const second = app.inject("/api/health/ready");
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
    release();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
  });

  it("returns 503 while the service is draining", async () => {
    const app = await build({ draining: () => true });

    const response = await app.inject("/api/health/ready");

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.accepting.ok).toBe(false);
  });

  it("returns 503 when the configured public media store cannot be read", async () => {
    const app = await build({
      publicMedia: async () => {
        throw new Error("qiniu unavailable");
      },
    });

    const response = await app.inject("/api/health/ready");

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.publicMedia).toMatchObject({
      ok: false,
      error: "公共媒体存储暂不可用。",
    });
  });
});
