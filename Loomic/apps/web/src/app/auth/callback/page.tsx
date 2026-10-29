"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { LoadingScreen } from "../../../components/loading-screen";
import { useAuth } from "../../../lib/auth-context";
import {
  exchangeDesktopLoginToken,
  exchangeLocalToken,
} from "../../../lib/local-auth";

function loginErrorUrl(error: string): string {
  return `/login?${new URLSearchParams({ error }).toString()}`;
}

function AuthCallbackPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { acceptSession } = useAuth();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const localToken = searchParams.get("local_token");
    const desktopToken = searchParams.get("desktop_token");
    const desktopState = searchParams.get("state");
    const oauthCode = searchParams.get("code");
    const oauthState = searchParams.get("state");

    if (oauthCode && oauthState) {
      window.location.href = `/api/integrations/douyin/oauth/exchange?code=${encodeURIComponent(oauthCode)}&state=${encodeURIComponent(oauthState)}`;
      return;
    }

    if (
      desktopToken &&
      desktopState &&
      /^[A-Za-z0-9_-]{43}$/.test(desktopState)
    ) {
      void exchangeDesktopLoginToken(desktopToken)
        .then(async (session) => {
          acceptSession(session);
          const electronAPI = (window as Window & {
            electronAPI?: {
              finishBrowserLogin: (success: boolean) => Promise<unknown>;
              getPendingMarketplaceInstall?: () => Promise<string | null>;
            };
          }).electronAPI;
          await electronAPI?.finishBrowserLogin(true);
          const pendingMarketplaceSlug = await Promise.resolve(
            electronAPI?.getPendingMarketplaceInstall?.(),
          ).catch(() => null);
          router.replace(pendingMarketplaceSlug ? "/desktop-app/marketplace/" : desktopState ? "/desktop-app/" : "/home/");
        })
        .catch(() => {
          void (
            window as Window & {
              electronAPI?: {
                finishBrowserLogin: (success: boolean) => Promise<unknown>;
              };
            }
          ).electronAPI?.finishBrowserLogin(false);
          router.replace(loginErrorUrl("desktop_auth_exchange_failed"));
        });
      return;
    }

    if (localToken) {
      void exchangeLocalToken(localToken)
        .then(() => router.replace("/home"))
        .catch(() => router.replace(loginErrorUrl("auth_exchange_failed")));
      return;
    }
    router.replace(loginErrorUrl("local_auth_callback_required"));
  }, [acceptSession, router, searchParams]);

  return <LoadingScreen />;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AuthCallbackPageContent />
    </Suspense>
  );
}
