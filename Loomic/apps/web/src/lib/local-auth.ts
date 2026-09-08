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
