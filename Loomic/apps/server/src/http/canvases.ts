import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  type CanvasGetResponse,
  applicationErrorResponseSchemaLoose,
  canvasGetResponseSchema,
  canvasSaveRequestSchema,
  canvasSaveResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@helstera/shared";

import type { RequestAuthenticator } from "../auth/types.js";
import {
  type CanvasService,
  CanvasServiceError,
} from "../features/canvas/canvas-service.js";
import type { VersionedCanvasService } from "../local-db/canvas-service.js";

/**
 * 版本承载方式：HTTP 头 `ETag` / `If-Match`（`W/"<version>"`），不用 body。
 *
 * 理由：
 * 1. 契约包 `packages/shared`（`contracts.ts` / `http.ts`）由其它分支占用，本次不允许改；
 *    `canvasSaveRequestSchema` 是 `z.object({ content })`，加 `baseVersion` 只能塞进 body
 *    的未知字段（会被 zod 剥掉），属于「靠约定」而不是「靠契约」。
 * 2. `If-Match` 是 HTTP 标准的前置条件语义，天然表达「我基于哪个版本改的」，
 *    代理/日志/客户端调试都能直接看见；409 天然对应「前置条件失败」。
 *
 * 兼容：body 里额外带一个 `version` 字段（GET 的是加法字段，PUT 的是新版本号）。
 * 这是可选的便利字段，权威通道仍然是 ETag 头 —— 老客户端读不懂也无所谓。
 */
export type VersionedCanvasGetResponse = CanvasGetResponse & {
  version?: number;
};

/**
 * 409 冲突包体。
 *
 * 为什么这里另起一个局部 schema：冲突包体多了服务端当前 `version` 字段，
 * 而 `applicationErrorResponseSchemaLoose` 只描述 `{ error: { code, message } }`。
 * （`canvas_version_conflict` / `invalid_if_match` 已登记进 shared 已知码白名单，
 * 出站错误仍统一用 `applicationErrorResponseSchemaLoose` 校验。）
 */
const canvasVersionConflictResponseSchema = z.object({
  error: z.object({
    code: z.literal("canvas_version_conflict"),
    message: z.string().min(1),
  }),
  version: z.number().int().min(1),
});

const invalidIfMatchResponseSchema = z.object({
  error: z.object({
    code: z.literal("invalid_if_match"),
    message: z.string().min(1),
  }),
});

export type ParsedIfMatch =
  | { kind: "absent" }
  /** `version: null` 表示 `If-Match: *`（存在即通过），不参与版本比对。 */
  | { kind: "match"; version: number | null }
  | { kind: "invalid" };

/** `W/"12"` / `"12"` → 12；缺失 → absent；其它写法 → invalid（400，而不是静默降级成老客户端）。 */
export function parseIfMatchVersion(
  header: string | string[] | undefined,
): ParsedIfMatch {
  const raw = Array.isArray(header) ? header.join(",") : header;
  if (raw === undefined) return { kind: "absent" };
  const value = raw.trim();
  if (value === "") return { kind: "absent" };
  if (value === "*") return { kind: "match", version: null };
  const match = /^(?:W\/)?"(\d+)"$/u.exec(value);
  if (!match) return { kind: "invalid" };
  const version = Number(match[1]);
  if (!Number.isInteger(version) || version < 1) return { kind: "invalid" };
  return { kind: "match", version };
}

export function formatCanvasEtag(version: number): string {
  return `W/"${version}"`;
}

export async function registerCanvasRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    canvasService: CanvasService;
  },
) {
  const versioned = asVersionedCanvasService(options.canvasService);

  app.get<{ Params: { canvasId: string } }>(
    "/api/canvases/:canvasId",
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user) return sendUnauthorized(reply);

        if (!versioned) {
          request.log.warn(
            { canvasId: request.params.canvasId },
            "canvas.get on a CanvasService without version support — no ETag emitted",
          );
          const canvas = await options.canvasService.getCanvas(
            user,
            request.params.canvasId,
          );
          return reply
            .code(200)
            .send(canvasGetResponseSchema.parse({ canvas }));
        }

        const { canvas, version } = await versioned.getCanvasWithVersion(
          user,
          request.params.canvasId,
        );
        const body: VersionedCanvasGetResponse = {
          ...canvasGetResponseSchema.parse({ canvas }),
          version,
        };
        return reply
          .code(200)
          .header("ETag", formatCanvasEtag(version))
          .header("Cache-Control", "no-store")
          .send(body);
      } catch (error) {
        return sendCanvasError(error, reply);
      }
    },
  );

  app.put<{ Params: { canvasId: string } }>(
    "/api/canvases/:canvasId",
    { bodyLimit: 50 * 1024 * 1024 }, // 50 MB — canvas content includes base64 image data
    async (request, reply) => {
      try {
        const user = await options.auth.authenticate(request);
        if (!user) return sendUnauthorized(reply);

        const ifMatch = parseIfMatchVersion(request.headers["if-match"]);
        if (ifMatch.kind === "invalid") {
          return reply.code(400).send(
            invalidIfMatchResponseSchema.parse({
              error: {
                code: "invalid_if_match",
                message: 'If-Match must be a canvas version, e.g. W/"3".',
              },
            }),
          );
        }

        const payload = canvasSaveRequestSchema.parse(request.body);
        const baseVersion = ifMatch.kind === "match" ? ifMatch.version : null;

        if (ifMatch.kind === "absent") {
          // 兼容现网 0.2.18 / 0.2.19：老客户端不带版本，按旧行为（后写覆盖前写）放行。
          // 这是有意的取舍：宁可留一条 warn 也不要把在用的客户端全部打挂在 428/409 上。
          request.log.warn(
            { canvasId: request.params.canvasId },
            "canvas.save without If-Match — legacy client, last write wins",
          );
        }

        const outcome = versioned
          ? await versioned.saveCanvasContentWithVersion(
              user,
              request.params.canvasId,
              payload.content,
              baseVersion,
            )
          : await saveWithLegacyService(
              options.canvasService,
              user,
              request.params.canvasId,
              payload.content,
            );

        if (outcome.status === "conflict") {
          request.log.warn(
            {
              canvasId: request.params.canvasId,
              baseVersion,
              currentVersion: outcome.version,
            },
            "canvas.save CONFLICT — nothing written",
          );
          return reply
            .code(409)
            .header("ETag", formatCanvasEtag(outcome.version))
            .header("Cache-Control", "no-store")
            .send(
              canvasVersionConflictResponseSchema.parse({
                error: {
                  code: "canvas_version_conflict",
                  message:
                    "Canvas was modified in another window. Reload or overwrite explicitly to continue.",
                },
                version: outcome.version,
              }),
            );
        }

        const bodySize = JSON.stringify(request.body).length;
        request.log.info(
          {
            canvasId: request.params.canvasId,
            bodyBytes: bodySize,
            version: outcome.version,
          },
          "canvas.save OK",
        );
        const responseBody = canvasSaveResponseSchema.parse({ ok: true });
        if (outcome.version === null) {
          return reply.code(200).send(responseBody);
        }
        return reply
          .code(200)
          .header("ETag", formatCanvasEtag(outcome.version))
          .header("Cache-Control", "no-store")
          .send({ ...responseBody, version: outcome.version });
      } catch (error) {
        request.log.error(
          { canvasId: request.params.canvasId, err: error },
          "canvas.save FAILED",
        );
        return sendCanvasError(error, reply);
      }
    },
  );
}

async function saveWithLegacyService(
  service: CanvasService,
  user: Parameters<CanvasService["saveCanvasContent"]>[0],
  canvasId: string,
  content: Parameters<CanvasService["saveCanvasContent"]>[2],
): Promise<{ status: "saved"; version: null }> {
  await service.saveCanvasContent(user, canvasId, content);
  return { status: "saved", version: null };
}

function asVersionedCanvasService(
  service: CanvasService,
): VersionedCanvasService | null {
  const candidate = service as Partial<VersionedCanvasService>;
  return typeof candidate.getCanvasWithVersion === "function" &&
    typeof candidate.saveCanvasContentWithVersion === "function"
    ? (candidate as VersionedCanvasService)
    : null;
}

function sendUnauthorized(reply: FastifyReply) {
  return reply.code(401).send(
    unauthenticatedErrorResponseSchema.parse({
      error: {
        code: "unauthorized",
        message: "Missing or invalid bearer token.",
      },
    }),
  );
}

function sendCanvasError(error: unknown, reply: FastifyReply) {
  if (error instanceof CanvasServiceError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchemaLoose.parse({
        error: {
          code: error.code,
          message: error.message,
        },
      }),
    );
  }

  if (isZodError(error)) {
    return reply.code(400).send({
      issues: error.issues,
      message: "Invalid request body",
    });
  }

  return reply.code(500).send(
    applicationErrorResponseSchemaLoose.parse({
      error: {
        code: "application_error",
        message: "Internal server error.",
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
