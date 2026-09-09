import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getTopupPackage } from "@helstera/shared";
import type { CreditService } from "../features/credits/credit-service.js";
import { buildEpayOrderUrl, verifyEpaySign } from "../features/payments/epay-client.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { RequestAuthenticator } from "../supabase/user.js";

const createSchema = z.object({
  packageId: z.string().min(1),
  type: z.enum(["alipay", "wxpay", "qqpay"]).default("alipay"),
});

export type EpayRouteOptions = {
  auth: RequestAuthenticator;
  creditService: CreditService;
  viewerService: ViewerService;
  baseUrl: string;
  merchantId: string;
  md5Key: string;
  notifyUrl: string;
};

export function registerEpayRoutes(
  app: FastifyInstance,
  options: EpayRouteOptions,
): void {
  app.post("/api/epay/topup", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "Missing or invalid session." } });

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_request", message: "Invalid top-up request." } });

    const viewer = await options.viewerService.ensureViewer(user);
    const pkg = getTopupPackage(parsed.data.packageId);
    if (!pkg) return reply.code(400).send({ error: { code: "invalid_package", message: "Unknown top-up package." } });

    const order = await options.creditService.createTopupOrder(
      viewer.workspace.id,
      pkg.id,
      "epay",
    );
    const checkoutUrl = buildEpayOrderUrl(options.baseUrl, {
      pid: options.merchantId,
      type: parsed.data.type,
      outTradeNo: order.outTradeNo,
      notifyUrl: options.notifyUrl,
      returnUrl: `${request.headers.origin ?? "https://studio.0st.top"}/settings?tab=billing&topup=${encodeURIComponent(order.outTradeNo)}`,
      name: pkg.name,
      money: (pkg.priceCnyFen / 100).toFixed(2),
    }, options.md5Key);

    return reply.send({ order, checkoutUrl });
  });

  app.post("/api/epay/notify", async (request, reply) => {
    const payload = Object.fromEntries(
      Object.entries((request.body ?? {}) as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]),
    );
    if (!verifyEpaySign(payload, options.md5Key)) return reply.code(401).send("fail");
    if (!payload.out_trade_no) return reply.code(400).send("fail");
    if (!payload.money) return reply.code(400).send("fail");
    if (payload.trade_status !== "TRADE_SUCCESS" && payload.trade_status !== "SUCCESS") return reply.send("success");

    const order = await options.creditService.getTopupOrder(payload.out_trade_no);
    if (!order || order.status === "expired") return reply.code(404).send("fail");
    if (Number(payload.money).toFixed(2) !== (order.amountCnyFen / 100).toFixed(2)) return reply.code(400).send("fail");

    await options.creditService.activateTopup(payload.out_trade_no, payload.trade_no || payload.out_trade_no);
    return reply.send("success");
  });
}
