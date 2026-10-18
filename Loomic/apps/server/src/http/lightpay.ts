import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getTopupPackage } from "@helstera/shared";
import type { CreditService } from "../features/credits/credit-service.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { RequestAuthenticator } from "../auth/types.js";
import type { LightPayClient } from "../features/payments/lightpay-client.js";

const schema = z.object({ packageId: z.string().min(1), method: z.enum(["web", "scan"]).default("web") });
export function registerLightPayRoutes(app: FastifyInstance, options: { auth: RequestAuthenticator; viewerService: ViewerService; creditService: CreditService; client: LightPayClient }): void {
  app.post("/api/payment/lightpay/topup", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "请先登录后再充值。" } });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_request", message: "充值参数无效。" } });
    const pkg = getTopupPackage(parsed.data.packageId);
    if (!pkg) return reply.code(400).send({ error: { code: "invalid_package", message: "充值套餐不存在。" } });
    const viewer = await options.viewerService.ensureViewer(user);
    const order = await options.creditService.createTopupOrder(viewer.workspace.id, pkg.id, "lightpay");
    const result = await options.client.createOrder({ orderId: order.outTradeNo, amount: (order.amountCnyFen / 100).toFixed(2), subject: `Helstera ${pkg.name}`, method: parsed.data.method });
    return { ok: true, data: { order, payment: result } };
  });
  app.post("/api/payment/lightpay/notify", async (request, reply) => {
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const timestamp = String(request.headers["x-lightpay-timestamp"] ?? "");
    const signature = String(request.headers["x-lightpay-signature"] ?? "");
    if (!options.client.verifyWebhook(timestamp, rawBody, signature)) return reply.code(401).send({ ok: false, error: "invalid_signature" });
    let body: { event?: string; order_id?: string; callback_id?: string; amount?: string };
    try { body = JSON.parse(rawBody) as typeof body; } catch { return reply.code(400).send({ ok: false, error: "invalid_json" }); }
    if (body.event === "payment.refunded") return reply.send({ ok: true });
    if (body.event !== "payment.paid" || !body.order_id) return reply.code(400).send({ ok: false, error: "invalid_event" });
    const order = await options.creditService.getTopupOrder(body.order_id);
    if (!order || order.provider !== "lightpay") return reply.code(404).send({ ok: false, error: "order_not_found" });
    if (body.amount && Number(body.amount).toFixed(2) !== (order.amountCnyFen / 100).toFixed(2)) return reply.code(400).send({ ok: false, error: "amount_mismatch" });
    await options.creditService.activateTopup(order.outTradeNo, body.callback_id ?? body.order_id);
    return reply.send({ ok: true });
  });
}
