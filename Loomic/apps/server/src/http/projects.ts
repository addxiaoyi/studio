import type { FastifyInstance, FastifyReply } from "fastify";

import {
  applicationErrorResponseSchemaLoose,
  projectCreateRequestSchema,
  projectCreateResponseSchema,
  projectListResponseSchema,
  projectUpdateRequestSchema,
  unauthenticatedErrorResponseSchema,
} from "@helstera/shared";

import {
  ProjectServiceError,
  type ProjectService,
} from "../features/projects/project-service.js";
import type { RequestAuthenticator } from "../auth/types.js";

const PROJECT_CREATE_KEY_TTL_MS = 10 * 60 * 1000;
const createdProjects = new Map<
  string,
  { expiresAt: number; project: Awaited<ReturnType<ProjectService["createProject"]>> }
>();
const pendingProjects = new Map<
  string,
  Promise<Awaited<ReturnType<ProjectService["createProject"]>>>
>();

export async function registerProjectRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    projectService: ProjectService;
  },
) {
  app.get("/api/projects/:projectId", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);

      if (!user) {
        return reply.code(401).send(
          unauthenticatedErrorResponseSchema.parse({
            error: {
              code: "unauthorized",
              message: "Missing or invalid bearer token.",
            },
          }),
        );
      }

      const { projectId } = request.params as { projectId: string };
      const project = await options.projectService.getProject(user, projectId);
      return reply.code(200).send({ project });
    } catch (error) {
      request.log.error({ err: error }, "project list failed");
      return sendProjectError(error, reply, "project_query_failed");
    }
  });

  app.get("/api/projects", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);

      if (!user) {
        return reply.code(401).send(
          unauthenticatedErrorResponseSchema.parse({
            error: {
              code: "unauthorized",
              message: "Missing or invalid bearer token.",
            },
          }),
        );
      }

      const projects = await options.projectService.listProjects(user);
      return reply.code(200).send(projectListResponseSchema.parse({ projects }));
    } catch (error) {
      return sendProjectError(error, reply, "project_query_failed");
    }
  });

  app.get("/api/projects/archived", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return reply.code(401).send(unauthenticatedErrorResponseSchema.parse({ error: { code: "unauthorized", message: "Missing or invalid bearer token." } }));
      const projects = await options.projectService.listArchivedProjects(user);
      return reply.code(200).send(projectListResponseSchema.parse({ projects }));
    } catch (error) {
      return sendProjectError(error, reply, "project_query_failed");
    }
  });

  app.delete("/api/projects/:projectId", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);

      if (!user) {
        return reply.code(401).send(
          unauthenticatedErrorResponseSchema.parse({
            error: {
              code: "unauthorized",
              message: "Missing or invalid bearer token.",
            },
          }),
        );
      }

      const { projectId } = request.params as { projectId: string };
      await options.projectService.archiveProject(user, projectId);
      return reply.code(204).send();
    } catch (error) {
      return sendProjectError(error, reply, "application_error");
    }
  });

  app.delete<{ Params: { projectId: string } }>("/api/projects/:projectId/if-empty", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return reply.code(401).send(unauthenticatedErrorResponseSchema.parse({ error: { code: "unauthorized", message: "Missing or invalid bearer token." } }));
      const deleted = await options.projectService.archiveEmptyProject(user, request.params.projectId);
      return reply.code(200).send({ deleted });
    } catch (error) {
      return sendProjectError(error, reply, "application_error");
    }
  });

  app.post<{ Params: { projectId: string } }>("/api/projects/:projectId/restore", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);
      if (!user) return reply.code(401).send(unauthenticatedErrorResponseSchema.parse({ error: { code: "unauthorized", message: "Missing or invalid bearer token." } }));
      await options.projectService.restoreProject(user, request.params.projectId);
      return reply.code(200).send({ restored: true });
    } catch (error) {
      return sendProjectError(error, reply, "project_update_failed");
    }
  });

  app.post("/api/projects", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);

      if (!user) {
        return reply.code(401).send(
          unauthenticatedErrorResponseSchema.parse({
            error: {
              code: "unauthorized",
              message: "Missing or invalid bearer token.",
            },
          }),
        );
      }

      const payload = projectCreateRequestSchema.parse(request.body);
      const rawKey = request.headers["idempotency-key"];
      const requestKey = typeof rawKey === "string" ? rawKey.trim() : "";
      if (requestKey.length > 128) {
        return reply.code(400).send({
          message: "Idempotency key is too long.",
        });
      }

      const cacheKey = requestKey ? `${user.id}:${requestKey}` : "";
      const cached = cacheKey ? createdProjects.get(cacheKey) : undefined;
      if (cached && cached.expiresAt > Date.now()) {
        return reply.code(200).send(
          projectCreateResponseSchema.parse({ project: cached.project }),
        );
      }
      if (cached) createdProjects.delete(cacheKey);

      const pending = cacheKey ? pendingProjects.get(cacheKey) : undefined;
      if (pending) {
        const project = await pending;
        return reply.code(200).send(
          projectCreateResponseSchema.parse({ project }),
        );
      }

      const createTask = options.projectService.createProject(user, payload);
      if (cacheKey) pendingProjects.set(cacheKey, createTask);

      let project: Awaited<ReturnType<ProjectService["createProject"]>>;
      try {
        project = await createTask;
      } finally {
        if (cacheKey) pendingProjects.delete(cacheKey);
      }

      if (cacheKey) {
        createdProjects.set(cacheKey, {
          expiresAt: Date.now() + PROJECT_CREATE_KEY_TTL_MS,
          project,
        });
      }

      return reply.code(201).send(
        projectCreateResponseSchema.parse({
          project,
        }),
      );
    } catch (error) {
      request.log.error({ err: error }, "project create failed");
      if (isZodError(error)) {
        return reply.code(400).send({
          issues: error.issues,
          message: "Invalid request body",
        });
      }

      return sendProjectError(error, reply, "project_create_failed");
    }
  });

  app.patch("/api/projects/:projectId", async (request, reply) => {
    try {
      const user = await options.auth.authenticate(request);

      if (!user) {
        return reply.code(401).send(
          unauthenticatedErrorResponseSchema.parse({
            error: {
              code: "unauthorized",
              message: "Missing or invalid bearer token.",
            },
          }),
        );
      }

      const { projectId } = request.params as { projectId: string };
      const payload = projectUpdateRequestSchema.parse(request.body);
      await options.projectService.updateProject(user, projectId, payload);

      return reply.code(204).send();
    } catch (error) {
      if (isZodError(error)) {
        return reply.code(400).send({
          issues: error.issues,
          message: "Invalid request body",
        });
      }

      return sendProjectError(error, reply, "project_update_failed");
    }
  });

  app.put<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/thumbnail",
    { bodyLimit: 2 * 1024 * 1024 }, // 2 MB for thumbnails
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user) {
          return reply.code(401).send(
            unauthenticatedErrorResponseSchema.parse({
              error: {
                code: "unauthorized",
                message: "Missing or invalid bearer token.",
              },
            }),
          );
        }

        const file = await request.file();
        if (!file) {
          return reply.code(400).send(
            applicationErrorResponseSchemaLoose.parse({
              error: {
                code: "upload_failed",
                message: "No file uploaded.",
              },
            }),
          );
        }

        const buffer = await file.toBuffer();
        const mimeType = file.mimetype || "image/webp";

        const result = await options.projectService.saveThumbnail(
          user,
          request.params.projectId,
          buffer,
          mimeType,
        );

        return reply.code(200).send(result);
      } catch (error) {
        request.log.error({ err: error }, "thumbnail upload error");
        return sendProjectError(error, reply, "project_create_failed");
      }
    },
  );
}

function sendProjectError(
  error: unknown,
  reply: FastifyReply,
  fallbackCode:
    | "application_error"
    | "project_create_failed"
    | "project_query_failed"
    | "project_update_failed",
) {
  if (error instanceof ProjectServiceError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchemaLoose.parse({
        error: {
          code: error.code,
          message: error.message,
        },
      }),
    );
  }

  return reply.code(500).send(
    applicationErrorResponseSchemaLoose.parse({
      error: {
        code: fallbackCode,
        message:
          fallbackCode === "project_query_failed"
            ? "Unable to load projects."
            : fallbackCode === "project_update_failed"
              ? "Unable to update project."
              : "Unable to create project.",
      },
    }),
  );
}

function isZodError(
  error: unknown,
): error is { issues: unknown[]; name: string } {
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    "issues" in error &&
    Array.isArray(error.issues)
  );
}
