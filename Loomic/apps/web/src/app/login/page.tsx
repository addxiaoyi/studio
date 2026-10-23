"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { AuthShell } from "../../components/auth/auth-shell";
import { LoadingScreen } from "../../components/loading-screen";
import { LoginForm } from "../../components/login-form";
import { useAuth } from "../../lib/auth-context";
import { t, useLocale } from "../../lib/i18n";
import { getSafeRedirect, loginPath } from "../../lib/navigation";

const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  auth_callback_missing_code:
    "The sign-in link is incomplete. Request a new one and try again.",
  auth_exchange_failed:
    "This sign-in link could not be verified. Request a new one and try again.",
  viewer_bootstrap_failed:
    "Your account was verified, but we could not open your workspace. Please try again.",
  auth_callback_timeout: "Sign-in took too long to complete. Please try again.",
};

function LoginPageContent() {
  const copy = t(useLocale()).authShell;
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");
  const desktopMode = searchParams.get("desktop") === "1";
  const redirectTo = getSafeRedirect(searchParams.get("redirect"));
  const initialErrorMessage = callbackError
    ? (CALLBACK_ERROR_MESSAGES[callbackError] ??
      "Could not complete sign-in. Please try again.")
    : null;

  useEffect(() => {
    if (callbackError) {
      const loginUrl =
        redirectTo === "/home" ? "/login/" : loginPath(redirectTo);
      router.replace(
        desktopMode
          ? `${loginUrl}${loginUrl.includes("?") ? "&" : "?"}desktop=1`
          : loginUrl,
      );
    }
    if (!loading && user) {
      router.replace(redirectTo);
    }
  }, [callbackError, desktopMode, redirectTo, user, loading, router]);

  if (loading || user) return <LoadingScreen />;

  return (
    <AuthShell
      title={copy.signInTitle}
      description={copy.signInDescription}
      features={copy.signInFeatures}
    >
      <LoginForm
        initialErrorMessage={initialErrorMessage}
        redirectTo={redirectTo}
      />
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <LoginPageContent />
    </Suspense>
  );
}
