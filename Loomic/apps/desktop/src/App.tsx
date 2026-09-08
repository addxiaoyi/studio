/**
 * Helstera Desktop App
 *
 * This module serves as the entry point for the Helstera Desktop application.
 * It mounts the Next.js web application within the Electron shell.
 *
 * Note: This desktop app shares the same codebase as the web app (@/apps/web).
 * In production builds, the Vite plugin bundles the web app and serves it
 * via the Electron BrowserWindow.
 */
import React from "react";
import { NextRouter, useRouter } from "next/router";

/**
 * App — Desktop shell that renders the web application.
 * Listens for IPC events from the main process (menu actions, etc.)
 * and dispatches them to the Next.js router.
 */
function AppShell() {
  const router = useRouter();

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return;

    window.electronAPI.onNavigate((path: string) => {
      router.push(path);
    });

    window.electronAPI.onNewProject(() => {
      // Trigger new project creation in the web app
      window.dispatchEvent(new CustomEvent("desktop:new-project"));
    });

    window.electronAPI.onExportCanvas(() => {
      window.dispatchEvent(new CustomEvent("desktop:export-canvas"));
    });
  }, [router]);

  // Render the actual web app component tree
  // In practice, this imports from the shared @/apps/web package
  return (
    <div className="h-screen w-screen overflow-hidden">
      {/* @ts-ignore */}
      <NextRouter.Provider>
        <App />
      </NextRouter.Provider>
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
