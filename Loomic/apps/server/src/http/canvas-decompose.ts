import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequestAuthenticator } from "../auth/types.js";

const requestSchema = z.object({
  imageDataUrl: z.string().startsWith("data:image/").max(20 * 1024 * 1024),
  width: z.number().positive().max(16384),
  height: z.number().positive().max(16384),
});

export function registerCanvasDecomposeRoutes(app: FastifyInstance, options: { auth: RequestAuthenticator }) {
  app.post("/api/canvas/decompose-image", { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized" } });
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_image", message: "图片数据无效或超过 20MB" } });
    const upstream = await fetch("http://127.0.0.1:18787/api/design/plan-background-decomposition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...parsed.data, sourceImageName: "canvas-generated-image.png" }),
      signal: AbortSignal.timeout(180_000),
    });
    const body = await upstream.json().catch(() => ({})) as Record<string, unknown>;
    if (!upstream.ok) return reply.code(502).send({ error: { code: "decompose_failed", message: typeof body.error === "string" ? body.error : "图片拆层服务暂不可用" } });
    return reply.send({ assets: Array.isArray(body.assets) ? body.assets : [], backgrounds: Array.isArray(body.backgrounds) ? body.backgrounds : [] });
  });
}
