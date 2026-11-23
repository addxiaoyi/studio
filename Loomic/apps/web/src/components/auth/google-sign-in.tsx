"use client";

import { useEffect, useState } from "react";
import { getServerBaseUrl } from "../../lib/env";
import { googleAuthMessage } from "../../lib/google-auth-message";
import { useLocale } from "../../lib/i18n";
import { getSafeRedirect } from "../../lib/navigation";

type GoogleProvider = { enabled: boolean; linkedEmail: string | null };

export function GoogleSignIn({
  returnTo = "/home/",
  linkAccount = false,
  callbackError,
}: {
  returnTo?: string;
  linkAccount?: boolean;
  callbackError?: string | null;
}) {
  const english = useLocale() === "en-US";
  const [provider, setProvider] = useState<GoogleProvider>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void fetch(`${getServerBaseUrl()}/api/local-auth/providers`, {
      credentials: "include",
      cache: attempt > 0 ? "reload" : "default",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Sign-in providers unavailable");
        const body = (await response.json()) as { google?: GoogleProvider };
        if (typeof body.google?.enabled !== "boolean")
          throw new Error("Invalid sign-in provider response");
        if (!controller.signal.aborted) setProvider(body.google);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [attempt]);
  function retryGoogle() {
    setAttempt((current) => current + 1);
  }

  if (error)
    return (
      <output className="mb-5 block text-sm text-muted-foreground">
        {english ? "Google sign-in is unavailable. " : "Google 登录暂不可用。"}
        <button
          type="button"
          onClick={retryGoogle}
          className="rounded underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {english ? "Retry" : "重试"}
        </button>
      </output>
    );
  if (!provider)
    return (
      <output className="mb-5 block text-xs text-muted-foreground">
        {english ? "Loading sign-in options…" : "正在加载登录方式…"}
      </output>
    );
  if (!provider.enabled) return null;
  const callbackMessage = googleAuthMessage(callbackError, english);
  const feedback = callbackMessage ? (
    <p role="alert" className="mb-3 text-sm text-destructive">
      {callbackMessage}
    </p>
  ) : null;
  if (linkAccount && provider.linkedEmail)
    return (
      <div>
        {feedback}
        <output className="block break-all text-sm text-muted-foreground">
          {english ? "Google connected: " : "已绑定 Google："}
          {provider.linkedEmail}
        </output>
      </div>
    );
  const query = new URLSearchParams({
    returnTo: getSafeRedirect(returnTo),
    ...(linkAccount ? { intent: "link" } : {}),
  });
  return (
    <div className={linkAccount ? "max-w-sm" : "mb-6"}>
      {feedback}
      <a
        href={`${getServerBaseUrl()}/api/local-auth/google/start?${query}`}
        className="inline-flex min-h-11 w-full items-center justify-center gap-3 rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.04 46.98 31.9 46.98 24.55Z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.78-4.59l-7.98-6.19A23.8 23.8 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
          />
        </svg>
        {linkAccount
          ? english
            ? "Connect Google account"
            : "绑定 Google 账号"
          : english
            ? "Sign in with Google"
            : "使用 Google 登录"}
      </a>
    </div>
  );
}
