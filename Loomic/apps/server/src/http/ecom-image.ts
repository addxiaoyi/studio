// @ecom-image — Fastify routes for e-commerce image generation
import { z } from "zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  applicationErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@helstera/shared";
import type { EcomService } from "../features/ecom-image/ecom-service.js";
import type { RequestAuthenticator } from "../supabase/user.js";

// ── Zod schemas ───────────────────────────────────────────

const createJobSchema = z.object({
  productName: z.string().min(1).max(120),
  productDescription: z.string().max(2000).optional(),
  sceneIds: z.array(z.string().min(1).max(40)).min(1).max(25),
  ratio: z
    .enum([
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "16:9",
      "9:16",
      "21:9",
      "9:21",
      "2:1",
      "1:2",
      "auto",
    ])
    .optional(),
  referenceImageUrl: z.string().url().optional(),
});

const listScenesQuerySchema = z.object({
  q: z.string().optional(),
});

// ── Public route shape ────────────────────────────────────

export type EcomRoutesDeps = {
  auth: RequestAuthenticator;
  ecomService: EcomService;
};

export async function registerEcomRoutes(
  app: FastifyInstance,
  deps: EcomRoutesDeps,
): Promise<void> {
  const { auth, ecomService } = deps;

  // GET /api/ecom/scenes — list all 25 scene templates (public metadata)
  app.get("/api/ecom/scenes", async (request, reply) => {
    const parsed = listScenesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(
        applicationErrorResponseSchema.parse({
          error: { code: "invalid_request", message: "Invalid query" },
        }),
      );
    }
    const scenes = ecomService.listScenes();
    if (parsed.data.q) {
      const q = parsed.data.q.toLowerCase();
      return reply.send({
        scenes: scenes.filter(
          (s: { name: string; nameZh: string; id: string }) =>
            s.name.toLowerCase().includes(q) ||
            s.nameZh.includes(q) ||
            s.id.includes(q),
        ),
      });
    }
    return reply.send({ scenes });
  });

  // POST /api/ecom/jobs — create a batch generation job
  app.post("/api/ecom/jobs", async (request, reply) => {
    const user = await auth.authenticate(request);
    if (!user) return sendUnauthenticated(reply);

    const body = request.body as Record<string, unknown>;
    const parsed = createJobSchema.safeParse(body);
    if (!parsed.success) {
      return reply.code(400).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "invalid_request",
            message: parsed.error.issues[0]?.message ?? "Invalid request body",
          },
        }),
      );
    }

    // Resolve the workspace the same way other routes do.
    // Note: the createJob method on the service expects workspaceId; for
    // a real deployment we'd resolve from the user's session. Here we use
    // a deterministic helper: the user's active workspace.
    const workspaceId = await resolveWorkspaceId(user.id);
    if (!workspaceId) {
      return reply.code(400).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "no_workspace",
            message: "User has no active workspace. Complete signup first.",
          },
        }),
      );
    }

    try {
      const result = await ecomService.createJob({
        workspaceId,
        userId: user.id,
        productName: parsed.data.productName,
        ...(parsed.data.productDescription
          ? { productDescription: parsed.data.productDescription }
          : {}),
        sceneIds: parsed.data.sceneIds as never,
        ...(parsed.data.ratio ? { ratio: parsed.data.ratio } : {}),
        ...(parsed.data.referenceImageUrl
          ? { referenceImageUrl: parsed.data.referenceImageUrl }
          : {}),
      });
      return reply.send({
        job: result.job,
        prompts: result.prompts,
      });
    } catch (err) {
      console.error("[EcomRoutes] createJob failed:", err);
      return reply.code(500).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "create_job_failed",
            message: err instanceof Error ? err.message : "Unknown error",
          },
        }),
      );
    }
  });

  // GET /api/ecom/jobs/:id — poll job status
  app.get<{ Params: { id: string } }>(
    "/api/ecom/jobs/:id",
    async (request, reply) => {
      const user = await auth.authenticate(request);
      if (!user) return sendUnauthenticated(reply);
      const job = await ecomService.getJob(request.params.id);
      if (!job) {
        return reply.code(404).send(
          applicationErrorResponseSchema.parse({
            error: { code: "not_found", message: "Job not found" },
          }),
        );
      }
      return reply.send({ job });
    },
  );

  // GET /api/ecom/jobs — list recent jobs for the workspace
  app.get("/api/ecom/jobs", async (request, reply) => {
    const user = await auth.authenticate(request);
    if (!user) return sendUnauthenticated(reply);
    const workspaceId = await resolveWorkspaceId(user.id);
    if (!workspaceId) return reply.send({ jobs: [] });
    const jobs = await ecomService.listJobs(workspaceId, 20);
    return reply.send({ jobs });
  });
}

// ── Helpers ───────────────────────────────────────────────

function sendUnauthenticated(reply: FastifyReply) {
  return reply.code(401).send(
    unauthenticatedErrorResponseSchema.parse({
      error: {
        code: "unauthorized",
        message: "Missing or invalid bearer token.",
      },
    }),
  );
}

/**
 * Resolve the active workspace for a user. In the real codebase this
 * would import from a shared helper; for the ecom feature we inline a
 * minimal version that consults the `workspaces` table.
 */
async function resolveWorkspaceId(userId: string): Promise<string | null> {
  // Lazy import to avoid circular deps at module-load time
  const { createAdminSupabaseClient } = await import("../supabase/admin.js");
  // createAdminSupabaseClient throws if env is missing; in this route
  // we just return null and let the caller handle the "no_workspace" case.
  let admin: ReturnType<typeof createAdminSupabaseClient> | null;
  try {
    admin = createAdminSupabaseClient({
      supabaseUrl: process.env.SUPABASE_URL ?? "",
      supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    });
  } catch {
    return null;
  }
  if (!admin) return null;
  const { data } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return (data?.workspace_id as string | null) ?? null;
}
