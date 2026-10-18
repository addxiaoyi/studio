"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AuthShell } from "../../components/auth/auth-shell";
import { LoadingScreen } from "../../components/loading-screen";
import { RegisterForm } from "../../components/register-form";
import { useAuth } from "../../lib/auth-context";
import { t, useLocale } from "../../lib/i18n";

export default function RegisterPage() {
  const copy = t(useLocale()).authShell;
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/home");
    }
  }, [user, loading, router]);

  if (loading || user) return <LoadingScreen />;

  return (
    <AuthShell
      title={copy.registerTitle}
      description={copy.registerDescription}
      features={copy.registerFeatures}
    >
      <RegisterForm />
    </AuthShell>
  );
}
