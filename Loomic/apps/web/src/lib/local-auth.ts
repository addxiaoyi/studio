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

export class LocalSessionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type SessionReply = { session: { access_token: string; user: { id: string; email: string } } | null };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function fetchLocalSession(signal?: AbortSignal): Promise<SessionReply> {
  const response = await localAuthFetch("/api/local-auth/session", { credentials: "include", ...(signal ? { signal } : {}) });
  if (!response.ok) throw new LocalSessionError("无法读取登录状态", response.status);
  let body: unknown;
  try { body = await response.json(); }
  catch (cause) { throw new Error("登录状态响应格式无效，请重试。", { cause }); }
  if (object(body) && body.session === null) return { session: null };
  if (!object(body) || !object(body.session) || typeof body.session.access_token !== "string" || !body.session.access_token.trim() ||
      !object(body.session.user) || typeof body.session.user.id !== "string" || !body.session.user.id || typeof body.session.user.email !== "string") {
    throw new Error("登录状态响应格式无效，请重试。");
  }
  return { session: { access_token: body.session.access_token, user: { id: body.session.user.id, email: body.session.user.email } } };
}

export async function exchangeLocalToken(token: string) {
  const response = await localAuthFetch("/api/local-auth/exchange", {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error("登录链接已过期或已使用");
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}

export function isDesktopCallbackUrl(value: string, state: string): boolean {
  try {
    const callback = new URL(value);
    const isProtocolHandler =
      callback.protocol === "helstera:" &&
      callback.hostname === "auth" &&
      callback.pathname === "/callback" &&
      !callback.port;
    const isLoopbackHandler =
      callback.protocol === "http:" &&
      callback.hostname === "127.0.0.1" &&
      callback.pathname === "/callback" &&
      callback.port !== "";
    const hasNoCredentials = !callback.username && !callback.password;
    const hasValidToken = /^[A-Za-z0-9_-]{43}$/.test(
      callback.searchParams.get("desktop_token") ?? "",
    );
    return (
      (isProtocolHandler || isLoopbackHandler) &&
      hasNoCredentials &&
      callback.hash === "" &&
      callback.searchParams.get("state") === state &&
      hasValidToken
    );
  } catch {
    return false;
  }
}

export async function confirmDesktopLogin(state: string, callbackUrl?: string): Promise<string> {
  const response = await localAuthFetch("/api/local-auth/desktop-confirm", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, callbackUrl }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? "无法确认桌面登录，请返回桌面重新发起。");
  }

  const body = await response.json() as { callbackUrl?: unknown };
  if (typeof body.callbackUrl !== "string") throw new Error("桌面登录回调无效，请重新发起。");
  if (!isDesktopCallbackUrl(body.callbackUrl, state)) {
    throw new Error("桌面登录回调地址校验失败。");
  }
  return new URL(body.callbackUrl).toString();
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
  const response = await localAuthFetch("/api/local-auth/sign-out", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new LocalSessionError("退出登录失败，请重试。", response.status);
}

/**
 * The account exists but was created through the email-code flow and has no password yet.
 * Callers must offer the code-based path instead of repeating a doomed password attempt.
 */
export class PasswordNotSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordNotSetError";
  }
}

export async function signInLocalWithPassword(email: string, password: string) {
  const response = await localAuthFetch("/api/local-auth/password", {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    const code = body?.error?.code;
    if (code === "password_not_set" || code === "no_password") {
      throw new PasswordNotSetError(body?.error?.message ?? "该账号还没有设置密码，请先用邮箱验证码登录");
    }
    throw new Error("邮箱或密码不正确");
  }
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}

export async function resetLocalPassword(email: string, code: string, password: string) {
  const response = await localAuthFetch("/api/local-auth/reset-password", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code, password }) });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message ?? "密码重置失败，请重试"); }
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}

export async function registerLocal(email: string, password: string, code: string) {
  const response = await localAuthFetch("/api/local-auth/register", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, code }) });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message ?? "注册失败，请稍后重试"); }
  return (await response.json()) as { access_token: string; user: { id: string; email: string } };
}
