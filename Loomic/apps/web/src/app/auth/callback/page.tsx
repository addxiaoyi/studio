"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { LoadingScreen } from "../../../components/loading-screen";
import { exchangeLocalToken } from "../../../lib/local-auth";

function loginErrorUrl(error: string): string {
  return `/login?${new URLSearchParams({ error }).toString()}`;
}

function AuthCallbackPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const localToken = searchParams.get("local_token");
    const oauthCode = searchParams.get("code");
    const oauthState = searchParams.get("state");

    if (oauthCode && oauthState) {
      window.location.href = `/api/integrations/douyin/oauth/exchange?code=${encodeURIComponent(oauthCode)}&state=${encodeURIComponent(oauthState)}`;
      return;
    }

    if (localToken) {
      void exchangeLocalToken(localToken)
        .then(() => router.replace("/home"))
        .catch(() => router.replace(loginErrorUrl("auth_exchange_failed")));
      return;
    }
    router.replace(loginErrorUrl("local_auth_callback_required"));
  }, [router, searchParams]);

  return <LoadingScreen />;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AuthCallbackPageContent />
    </Suspense>
  );
}
