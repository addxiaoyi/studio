"use client";

import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { AuthProvider } from "../lib/auth-context";
import { ToastProvider } from "./toast";
import { TierLimitToastProvider } from "./credits/tier-limit-toast";
import { installErrorReporter } from "../lib/error-reporter";
import { installWebVitals } from "../lib/web-vitals";
import { AgentBrowserDock } from "./agent-browser/dock";
import { DesktopBackupBridge } from "./desktop-storage-panel";

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
      <MotionConfig reducedMotion="user">
        <ClientInstrumentation />
        <AuthProvider>
          <ToastProvider>
            <TierLimitToastProvider>{children}<AgentBrowserDock /><DesktopBackupBridge /></TierLimitToastProvider>
          </ToastProvider>
        </AuthProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
