"use client";

import type { ReactNode } from "react";
import { DesktopConnectionBanner } from "@/components/desktop-connection-banner";
import { DesktopExtensionBridge } from "@/components/desktop-extension-bridge";
import { DesktopToastProvider } from "@/components/desktop-toast";
import { useAuth } from "@/lib/auth-context";
import { AgentBrowserButton } from "@/components/agent-browser/open-button";
import { usePathname } from "next/navigation";

/**
 * Desktop shell capability boundary.
 *
 * Toast and the connectivity banner used to be mounted per page branch inside
 * `desktop-app-page.tsx`, which meant every new mode had to remember to copy them and
 * three other desktop routes rendered without them at all — their toast calls silently
 * hit a no-op. Mounting once here makes the capability non-optional for every route
 * under /desktop-app, including modes that do not exist yet.
 */
export default function DesktopAppLayout({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const pathname=usePathname();
  return (
    <DesktopToastProvider>
      <DesktopConnectionBanner />
      <DesktopExtensionBridge accessToken={session?.access_token ?? ""} />
      {session&&!pathname.startsWith("/desktop-app/canvas")&&<div className="flex shrink-0 justify-end border-b border-border px-3 py-1"><AgentBrowserButton/></div>}
      {children}
    </DesktopToastProvider>
  );
}
