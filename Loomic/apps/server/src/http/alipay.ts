import { readFileSync } from "node:fs";
import { createSign, createVerify } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getTopupPackage } from "@helstera/shared";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { CreditService } from "../features/credits/credit-service.js";
import type { RequestAuthenticator } from "../auth/types.js";

const ALIPAY_GATEWAY = "https://openapi.alipay.com/gateway.do";
const createOrderSchema = z.object({
  packageId: z.string().min(1),
  mode: z.enum(["page", "qr"]).default("page"),
});

export type AlipayRouteOptions = {
  appId: string;
  appPrivateKeyPath: string;
  creditService: CreditService;
  notifyUrl: string;
  platformPublicKeyPath: string;
  viewerService: ViewerService;
  webOrigin: string;
  auth: RequestAuthenticator;
};

export function registerUnavailableAlipayRoutes(app: FastifyInstance): void {
  ensureFormParser(app);
  app.post("/api/payment/alipay/notify", async (_request, reply) => {
    return reply.code(503).type("text/plain").send("failure");
  });
}

type AlipayConfig = {
  appId: string;
  appPrivateKey: string;
  platformPublicKey: string;
  notifyUrl: string;
  webOrigin: string;
};

export function registerAlipayRoutes(
  app: FastifyInstance,
  options: AlipayRouteOptions,
): void {
  const config: AlipayConfig = {
    appId: options.appId,
    appPrivateKey: readFileSync(options.appPrivateKeyPath, "utf8"),
    platformPublicKey: readFileSync(options.platformPublicKeyPath, "utf8"),
    notifyUrl: options.notifyUrl,
    webOrigin: options.webOrigin,
  };

  ensureFormParser(app);

  app.post("/api/payment/alipay/topup", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ error: { code: "unauthorized", message: "请先登录后再充值。" } });

    const parsed = createOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_request", message: "充值参数无效。" } });

    const pkg = getTopupPackage(parsed.data.packageId);
    if (!pkg) return reply.code(400).send({ error: { code: "invalid_package", message: "充值套餐不存在。" } });

    const viewer = await options.viewerService.ensureViewer(user);
    const order = await options.creditService.createTopupOrder(viewer.workspace.id, pkg.id, "alipay");
    const subject = `Helstera ${pkg.name}`.slice(0, 256);
    const method = parsed.data.mode === "qr" ? "alipay.trade.precreate" : "alipay.trade.page.pay";
    const parameters = signedParameters(config, method, {
      notify_url: config.notifyUrl,
      ...(parsed.data.mode === "page" ? { return_url: `${config.webOrigin}/settings?tab=billing&topup=${encodeURIComponent(order.outTradeNo)}` } : {}),
      biz_content: JSON.stringify({
        out_trade_no: order.outTradeNo,
        total_amount: (order.amountCnyFen / 100).toFixed(2),
        subject,
        product_code: parsed.data.mode === "page" ? "FAST_INSTANT_TRADE_PAY" : undefined,
        timeout_express: "30m",
      }),
    });

    if (parsed.data.mode === "page") {
      return { ok: true, data: { order, checkoutUrl: `${ALIPAY_GATEWAY}?${new URLSearchParams(parameters)}` } };
    }

    const response = await fetch(`${ALIPAY_GATEWAY}?${new URLSearchParams(parameters)}`, { method: "POST" });
    if (!response.ok) return reply.code(502).send({ error: { code: "alipay_unavailable", message: "支付宝服务暂不可用，请稍后重试。" } });
    const payload = await response.json() as Record<string, Record<string, string>>;
    const result = payload.alipay_trade_precreate_response;
    if (!result || result.code !== "10000" || !result.qr_code) {
      console.error("[alipay] precreate failed:", result?.code, result?.sub_code);
      return reply.code(502).send({ error: { code: "alipay_order_failed", message: "支付宝订单创建失败，请稍后重试。" } });
    }
    return { ok: true, data: { order, qrCode: result.qr_code } };
  });

  app.post("/api/payment/alipay/notify", async (request, reply) => {
    const payload = normalizePayload(request.body);
    if (!verifyNotification(payload, config.platformPublicKey)) {
      console.warn("[alipay] rejected notification: invalid signature");
      return reply.code(401).send("failure");
    }
    if (payload.app_id !== config.appId || payload.trade_status !== "TRADE_SUCCESS") return reply.send("success");
    if (!payload.out_trade_no || !payload.trade_no || !payload.total_amount) return reply.code(400).send("failure");

    const order = await options.creditService.getTopupOrder(payload.out_trade_no);
    if (!order || order.provider !== "alipay" || order.status === "expired") return reply.code(404).send("failure");
    if ((order.amountCnyFen / 100).toFixed(2) !== Number(payload.total_amount).toFixed(2)) {
      console.warn("[alipay] rejected notification: amount mismatch", payload.out_trade_no);
      return reply.code(400).send("failure");
    }
    await options.creditService.activateTopup(order.outTradeNo, payload.trade_no);
    return reply.send("success");
  });
}

function signedParameters(config: AlipayConfig, method: string, extra: Record<string, string>): Record<string, string> {
  const parameters: Record<string, string> = {
    app_id: config.appId,
    charset: "utf-8",
    format: "JSON",
    method,
    sign_type: "RSA2",
    timestamp: formatTimestamp(new Date()),
    version: "1.0",
    ...extra,
  };
  const signer = createSign("RSA-SHA256");
  signer.update(canonicalize(parameters));
  parameters.sign = signer.sign(config.appPrivateKey, "base64");
  return parameters;
}

function verifyNotification(payload: Record<string, string>, publicKey: string): boolean {
  const signature = payload.sign;
  if (!signature || payload.sign_type !== "RSA2") return false;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(canonicalize(payload));
  return verifier.verify(publicKey, signature, "base64");
}

function canonicalize(parameters: Record<string, string>): string {
  return Object.entries(parameters)
    .filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function normalizePayload(body: unknown): Record<string, string> {
  if (typeof body === "string") return Object.fromEntries(new URLSearchParams(body));
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return Object.fromEntries(Object.entries(body as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]));
}

function ensureFormParser(app: FastifyInstance): void {
  if (app.hasContentTypeParser("application/x-www-form-urlencoded")) return;
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
