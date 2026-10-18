import type { FastifyInstance } from "fastify";

type ErrorReport = {
  message?: unknown;
  severity?: unknown;
  context?: unknown;
  url?: unknown;
};

function text(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, maxLength);
}

export async function registerErrorRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ErrorReport }>("/api/errors", async (request, reply) => {
    const body = request.body ?? {};
    request.log.warn(
      {
        clientMessage: text(body.message, 500),
        severity: text(body.severity, 20),
        context: text(body.context, 100),
        page: text(body.url, 500),
      },
      "client error report",
    );
    return reply.code(204).send();
  });
}
