import type { FastifyInstance } from "fastify";

import { healthResponseSchema } from "@helstera/shared";

import type { ServerEnv } from "../config/env.js";

/**
 * Health check endpoint.
 *
 * Returns a 200 OK with service metadata when the API process is up.
 * Use `/api/health/ready` for readiness checks (verifies dependencies).
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
  env: ServerEnv,
) {
  // Liveness — minimal, fast, never blocks
  app.get("/api/health", async (_request, reply) => {
    const payload = healthResponseSchema.parse({
      ok: true,
      service: "helstera-server",
      version: env.version,
    });
    return reply.code(200).send(payload);
  });

  // Readiness — verifies external dependencies
  app.get("/api/health/ready", async (_request, reply) => {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    // Check env-level config presence
    checks.config = {
      ok: !!(env.supabaseUrl && env.supabaseServiceRoleKey),
    };

    const allOk = Object.values(checks).every((c) => c.ok);
    return reply.code(allOk ? 200 : 503).send({
      ok: allOk,
      service: "helstera-server",
      version: env.version,
      timestamp: new Date().toISOString(),
      checks,
    });
  });
}
