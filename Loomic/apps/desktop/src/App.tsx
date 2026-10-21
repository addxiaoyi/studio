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

/**
 * App — Desktop shell that renders the web application.
 * Listens for IPC events from the main process (menu actions, etc.)
 * and dispatches them to the Next.js router.
 */
function AppShell() {
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return;

    window.electronAPI.onNavigate((path: string) => {
      window.location.hash = path;
    });

    window.electronAPI.onNewProject(() => {
      // Trigger new project creation in the web app
      window.dispatchEvent(new CustomEvent("desktop:new-project"));
    });

    window.electronAPI.onExportCanvas(() => {
      window.dispatchEvent(new CustomEvent("desktop:export-canvas"));
    });
  }, []);

  return (
    <div style={{ minHeight: "100vh", padding: 32, background: "#f7f7f4", color: "#191918", fontFamily: "system-ui, sans-serif" }}>
      <main style={{ maxWidth: 760, margin: "0 auto" }}>
        <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.6 }}>Helstera Desktop</p>
        <h1 style={{ margin: "12px 0 8px", fontSize: 28 }}>本地浏览助手已就绪</h1>
        <p style={{ maxWidth: 600, lineHeight: 1.7, color: "#666660" }}>
          通过设置页生成一次性配对码后，可以连接桌面内嵌浏览器，读取用户明确选择的网站页面并生成截图、录屏和中文介绍。
        </p>
        <button type="button" onClick={() => { window.location.hash = "/settings"; }} style={{ marginTop: 20, minHeight: 40, border: 0, borderRadius: 8, padding: "0 16px", background: "#191918", color: "white", cursor: "pointer" }}>
          打开助手设置
        </button>
      </main>
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
