"use client";

import type { ReactNode } from "react";
import { DesktopConnectionBanner } from "@/components/desktop-connection-banner";
import { DesktopToastProvider } from "@/components/desktop-toast";

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
  return (
    <DesktopToastProvider>
      <DesktopConnectionBanner />
      {children}
    </DesktopToastProvider>
  );
}
