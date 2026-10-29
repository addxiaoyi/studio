"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * The pre-0.2 desktop shell (`/desktop/?mode=…`) is retired.
 *
 * It was a second, narrower shell: no titlebar, no sidebar, no toast layer and no
 * connectivity banner, so anything rendered there silently lost the desktop chrome.
 * Old bookmarks and links still work — they are forwarded into the current shell
 * instead of landing on a page that looks broken.
 */
const MODE_TARGETS: Record<string, string> = {
  "": "/desktop-app/",
  projects: "/desktop-app/projects/",
  assets: "/desktop-app/assets/",
  mcp: "/desktop-app/mcp/",
  code: "/desktop-app/development/",
  development: "/desktop-app/development/",
  marketplace: "/desktop-app/marketplace/",
  settings: "/desktop-app/settings/",
};

function LegacyDesktopRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const mode = searchParams.get("mode") ?? "";
    router.replace(MODE_TARGETS[mode] ?? "/desktop-app/");
  }, [router, searchParams]);

  return (
    <main className="desktop-module-loading" aria-busy="true" aria-live="polite">
      <p>正在打开新版桌面端…</p>
    </main>
  );
}

export default function DesktopPage() {
  return (
    <Suspense fallback={<main className="desktop-module-loading" aria-busy="true" />}>
      <LegacyDesktopRedirect />
    </Suspense>
  );
}
