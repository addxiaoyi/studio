import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { loadServerEnv } from "../config/env.js";
import { registerHealthRoutes } from "./health.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.map(app => app.close())); apps.length = 0; });
const env = loadServerEnv({ databaseUrl: "postgresql://localhost/test", storageRoot: "/storage", version: "candidate-test" }, {});

it("requires actual database and storage checks and keeps liveness independent", async () => {
  const app = Fastify(); apps.push(app);
  const database = vi.fn().mockRejectedValue(new Error("password=must-not-leak")), storage = vi.fn().mockResolvedValue(undefined);
  await registerHealthRoutes(app, env, { database, storage, draining: () => false });
  const ready = await app.inject("/api/health/ready");
  expect(ready.statusCode).toBe(503); expect(ready.json().checks.database.ok).toBe(false);
  expect(ready.body).not.toContain("must-not-leak"); expect(storage).toHaveBeenCalled();
  expect((await app.inject("/api/health")).statusCode).toBe(200);
  database.mockResolvedValue(undefined);
  const success = await app.inject("/api/health/ready"); expect(success.statusCode).toBe(200); expect(success.json().version).toBe("candidate-test");
});

it("refuses traffic while draining and coalesces concurrent dependency probes", async () => {
  const app = Fastify(); apps.push(app); let draining = false;
  const database = vi.fn(async () => new Promise<void>(resolve => setTimeout(resolve, 30))), storage = vi.fn().mockResolvedValue(undefined);
  await registerHealthRoutes(app, env, { database, storage, draining: () => draining });
  const replies = await Promise.all([app.inject("/api/health/ready"), app.inject("/api/health/ready")]);
  expect(replies.every(reply => reply.statusCode === 200)).toBe(true); expect(database).toHaveBeenCalledTimes(1);
  draining = true; expect((await app.inject("/api/health/ready")).statusCode).toBe(503);
});
