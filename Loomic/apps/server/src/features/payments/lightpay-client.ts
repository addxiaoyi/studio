import { createHmac, timingSafeEqual } from "node:crypto";

export type LightPayClient = {
  createOrder(input: { orderId: string; amount: string; subject: string; method: "web" | "scan" }): Promise<unknown>;
  verifyWebhook(timestamp: string, rawBody: string, signature: string): boolean;
};

export function createLightPayClient(options: { baseUrl: string; apiId: string; apiSecret: string }): LightPayClient {
  const sign = (timestamp: string, body: string) => `sha256=${createHmac("sha256", options.apiSecret).update(`${timestamp}\n${body}`).digest("hex")}`;
  return {
    async createOrder(input) {
      const body = JSON.stringify({ order_id: input.orderId, amount: input.amount, method: input.method, subject: input.subject });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const response = await fetch(new URL("/pay/api/orders.php", options.baseUrl), { method: "POST", headers: { "content-type": "application/json", "X-Lightpay-Api-Id": options.apiId, "X-Lightpay-Timestamp": timestamp, "X-Lightpay-Signature": sign(timestamp, body) }, body });
      if (!response.ok) throw new Error(`LightPay order request failed with HTTP ${response.status}`);
      return response.json();
    },
    verifyWebhook(timestamp, rawBody, signature) {
      const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
      if (!Number.isFinite(age) || age > 300 || !signature.startsWith("sha256=")) return false;
      const expected = sign(timestamp, rawBody);
      const actual = Buffer.from(signature);
      const wanted = Buffer.from(expected);
      return actual.length === wanted.length && timingSafeEqual(actual, wanted);
    },
  };
}
