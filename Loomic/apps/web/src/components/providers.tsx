"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { AuthProvider } from "../lib/auth-context";
import { ToastProvider } from "./toast";
import { TierLimitToastProvider } from "./credits/tier-limit-toast";
import { installErrorReporter } from "../lib/error-reporter";
import { installWebVitals } from "../lib/web-vitals";

function ClientInstrumentation() {
  useEffect(() => {
    installErrorReporter();
    installWebVitals();
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <ClientInstrumentation />
      <AuthProvider>
        <ToastProvider>
          <TierLimitToastProvider>{children}</TierLimitToastProvider>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
