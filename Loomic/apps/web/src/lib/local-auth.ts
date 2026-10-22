import { getServerBaseUrl } from "./env";

async function localAuthFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${getServerBaseUrl()}${path}`, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("无法连接登录服务，请检查网络或代理后重试；也可以切换到密码登录。", { cause: error });
    }
    throw error;
  }
}

export async function requestLocalMagicLink(email: string): Promise<void> {
  const response = await localAuthFetch("/api/local-auth/magic-link", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error("登录邮件发送失败，请稍后重试");
}

export async function requestLocalCode(email: string): Promise<void> {
  const response = await localAuthFetch("/api/local-auth/send-code", {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? "验证码发送失败，请稍后重试");
  }
}

export async function verifyLocalCode(email: string, code: string) {
  const response = await localAuthFetch("/api/local-auth/verify-code", {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? "验证码错误或已过期");
  }
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}

export async function fetchLocalSession() {
  const response = await localAuthFetch("/api/local-auth/session", { credentials: "include" });
  if (!response.ok) throw new Error("无法读取登录状态");
  return (await response.json()) as { session: { access_token: string; user: { id: string; email: string } } | null };
}

export async function exchangeLocalToken(token: string) {
  const response = await localAuthFetch("/api/local-auth/exchange", {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error("登录链接已过期或已使用");
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}

export async function confirmDesktopLogin(state: string): Promise<string> {
  const response = await localAuthFetch("/api/local-auth/desktop-confirm", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? "无法确认桌面登录，请返回桌面重新发起。");
  }

  const body = await response.json() as { callbackUrl?: unknown };
  if (typeof body.callbackUrl !== "string") throw new Error("桌面登录回调无效，请重新发起。");
  const callback = new URL(body.callbackUrl);
  if (callback.protocol !== "helstera:" || callback.hostname !== "auth" || callback.pathname !== "/callback" || callback.searchParams.get("state") !== state || !callback.searchParams.has("desktop_token")) {
    throw new Error("桌面登录回调地址校验失败。");
  }
  return callback.toString();
}

export async function exchangeDesktopLoginToken(token: string) {
  const response = await localAuthFetch("/api/local-auth/desktop-exchange", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error("桌面登录授权已过期或已使用，请重新发起。");
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}

export async function signOutLocal(): Promise<void> {
  await localAuthFetch("/api/local-auth/sign-out", {
    method: "POST",
    credentials: "include",
  });
}

export async function signInLocalWithPassword(email: string, password: string) {
  const response = await localAuthFetch("/api/local-auth/password", {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error("邮箱或密码不正确");
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}

export async function resetLocalPassword(email: string, code: string, password: string) {
  const response = await localAuthFetch("/api/local-auth/reset-password", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code, password }) });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message ?? "密码重置失败，请重试"); }
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}

export async function registerLocal(email: string, password: string) {
  const response = await localAuthFetch("/api/local-auth/register", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message ?? "注册失败，请稍后重试"); }
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}
