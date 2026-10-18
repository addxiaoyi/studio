import { getServerBaseUrl } from "./env";

export async function requestLocalMagicLink(email: string): Promise<void> {
  const response = await fetch(`${getServerBaseUrl()}/api/local-auth/magic-link`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error("登录邮件发送失败，请稍后重试");
}

export async function requestLocalCode(email: string): Promise<void> {
  const response = await fetch(`${getServerBaseUrl()}/api/local-auth/send-code`, {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? "验证码发送失败，请稍后重试");
  }
}

export async function verifyLocalCode(email: string, code: string) {
  const response = await fetch(`${getServerBaseUrl()}/api/local-auth/verify-code`, {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? "验证码错误或已过期");
  }
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}

export async function fetchLocalSession() {
  const response = await fetch(`${getServerBaseUrl()}/api/local-auth/session`, { credentials: "include" });
  if (!response.ok) throw new Error("无法读取登录状态");
  return (await response.json()) as { session: { access_token: string; user: { id: string; email: string } } | null };
}

export async function exchangeLocalToken(token: string) {
  const response = await fetch(`${getServerBaseUrl()}/api/local-auth/exchange`, {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error("登录链接已过期或已使用");
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}

export async function signOutLocal(): Promise<void> {
  await fetch(`${getServerBaseUrl()}/api/local-auth/sign-out`, {
    method: "POST",
    credentials: "include",
  });
}

export async function signInLocalWithPassword(email: string, password: string) {
  const response = await fetch(`${getServerBaseUrl()}/api/local-auth/password`, {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error("邮箱或密码不正确");
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}

export async function resetLocalPassword(email: string, code: string, password: string) {
  const response = await fetch(`${getServerBaseUrl()}/api/local-auth/reset-password`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code, password }) });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message ?? "密码重置失败，请重试"); }
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}

export async function registerLocal(email: string, password: string) {
  const response = await fetch(`${getServerBaseUrl()}/api/local-auth/register`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message ?? "注册失败，请稍后重试"); }
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}
