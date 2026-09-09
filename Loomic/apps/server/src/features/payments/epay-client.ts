import { createHash, timingSafeEqual } from "node:crypto";

export type EpaySignType = "MD5" | "RSA";

export type EpayOrderParams = {
  pid: string;
  type: string;
  outTradeNo: string;
  notifyUrl: string;
  returnUrl: string;
  name: string;
  money: string;
};

export function buildEpaySign(
  params: Record<string, string | number | undefined>,
  key: string,
): string {
  const canonical = Object.entries(params)
    .filter(([name, value]) => name !== "sign" && name !== "sign_type" && value !== undefined && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");

  return createHash("md5")
    .update(`${canonical}${key}`, "utf8")
    .digest("hex")
    .toLowerCase();
}

export function verifyEpaySign(
  params: Record<string, string | number | undefined>,
  key: string,
): boolean {
  const provided = String(params.sign ?? "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(provided)) return false;
  const expected = buildEpaySign(params, key);
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function buildEpayOrderUrl(
  baseUrl: string,
  order: EpayOrderParams,
  key: string,
): string {
  const params = {
    pid: order.pid,
    type: order.type,
    out_trade_no: order.outTradeNo,
    notify_url: order.notifyUrl,
    return_url: order.returnUrl,
    name: order.name,
    money: order.money,
  };
  const query = new URLSearchParams({
    ...params,
    sign: buildEpaySign(params, key),
    sign_type: "MD5",
  });
  return `${baseUrl.replace(/\/$/, "")}/mapi.php?${query.toString()}`;
}
