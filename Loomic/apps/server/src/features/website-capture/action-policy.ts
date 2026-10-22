import type { WebsiteActionRequest } from "@helstera/shared";
export type { WebsiteActionRequest } from "@helstera/shared";

export type WebsiteActionDecision =
  | { state: "allow"; reason: string }
  | { state: "confirm"; reason: string }
  | { state: "deny"; reason: string };

export function classifyWebsiteAction(action: WebsiteActionRequest | null | undefined): WebsiteActionDecision {
  if (!action || typeof action !== "object" || typeof action.kind !== "string") {
    return { state: "deny", reason: "动作格式无效。" };
  }
  if (!["navigate", "scroll", "click", "fill", "upload", "download", "submit", "publish", "purchase", "payment", "authorize"].includes(action.kind)) {
    return { state: "deny", reason: "动作类型不受支持。" };
  }
  const fieldType = (action.fieldType ?? "").toLowerCase().replace(/[\s_]+/g, "-");
  if (/password|passcode|one-time-code|otp|verification-code|auth-code|\bmfa\b/.test(fieldType)) {
    return { state: "deny", reason: "Helstera 不代输密码、验证码或 OTP。" };
  }
  if (["upload", "download", "publish", "purchase", "payment", "authorize", "submit"].includes(action.kind)) {
    return { state: "confirm", reason: "该动作可能产生外部副作用，需要当前用户确认。" };
  }
  if (action.kind === "fill" || action.sideEffect === true) {
    return { state: "confirm", reason: "填写内容或可能改变外部状态，需要当前用户确认。" };
  }
  if (action.kind === "navigate" || action.kind === "scroll") {
    return { state: "allow", reason: "导航和滚动不会提交外部副作用。" };
  }
  if (action.kind === "click") {
    return { state: "confirm", reason: "页面提供的控件描述未经验证，点击前需要当前用户确认。" };
  }
  return { state: "allow", reason: "未检测到表单提交或外部副作用。" };
}
