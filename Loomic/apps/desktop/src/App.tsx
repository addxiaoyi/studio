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

import DesktopAgentHistoryPanel from "./AgentHistoryPanel";
import DesktopAgentProgressCards from "./AgentProgressCards";
import { DESKTOP_DOWNLOADS_URL, isPortableManualUpdate } from "./update-download";

type DesktopUpdateState = {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
  reason?: "portable build requires manual update";
};

type DesktopApi = {
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdates: () => Promise<DesktopUpdateState>;
  installUpdate: () => Promise<{ ok: boolean }>;
  onUpdateState: (callback: (state: DesktopUpdateState) => void) => () => void;
  onNavigate: (callback: (path: string) => void) => void;
  onNewProject: (callback: () => void) => void;
  onExportCanvas: (callback: () => void) => void;
};

/**
 * App — Desktop shell that renders the web application.
 * Listens for IPC events from the main process (menu actions, etc.)
 * and dispatches them to the Next.js router.
 */
function AppShell() {
  const api = (window as Window & { electronAPI?: DesktopApi }).electronAPI;
  const [update, setUpdate] = React.useState<DesktopUpdateState | null>(null);
  const [updateBusy, setUpdateBusy] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  React.useEffect(() => {
    if (!api) return;

    api.onNavigate((path: string) => {
      window.location.hash = path;
    });

    api.onNewProject(() => {
      // Trigger new project creation in the web app
      window.dispatchEvent(new CustomEvent("desktop:new-project"));
    });

    api.onExportCanvas(() => {
      window.dispatchEvent(new CustomEvent("desktop:export-canvas"));
    });
    void api.getUpdateState().then(setUpdate);
    return api.onUpdateState(setUpdate);
  }, [api]);

  const checkUpdates = async () => {
    if (!api || updateBusy) return;
    setUpdateBusy(true);
    try {
      setUpdate(await api.checkForUpdates());
    } finally {
      setUpdateBusy(false);
    }
  };

  const installUpdate = async () => {
    if (!api || updateBusy) return;
    setUpdateBusy(true);
    try {
      await api.installUpdate();
    } finally {
      setUpdateBusy(false);
    }
  };

  const openDownloadPage = () => {
    window.open(DESKTOP_DOWNLOADS_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={{ minHeight: "100vh", padding: 32, background: "#f7f7f4", color: "#191918", fontFamily: "system-ui, sans-serif" }}>
      <DesktopAgentProgressCards />
      <DesktopAgentHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <main style={{ maxWidth: 760, margin: "0 auto" }}>
        <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.6 }}>Helstera Desktop</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ margin: "12px 0 8px", fontSize: 28 }}>本地浏览助手已就绪</h1>
          <button type="button" onClick={() => setHistoryOpen(true)} style={{ minHeight: 34, borderRadius: 8, border: "1px solid #d8d8d2", background: "#fff", cursor: "pointer", padding: "0 14px", fontSize: 13 }}>
            Agent 任务历史
          </button>
        </div>
        <p style={{ maxWidth: 600, lineHeight: 1.7, color: "#666660" }}>
          通过设置页生成一次性配对码后，可以连接桌面内嵌浏览器，读取用户明确选择的网站页面并生成截图、录屏和中文介绍。
        </p>
        {api && update && (
          <section aria-live="polite" style={{ marginTop: 24, padding: 16, border: "1px solid #d8d8d2", borderRadius: 10, background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>自动更新</p>
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#666660" }}>
                  {update.message ?? (update.status === "checking" ? "正在检查更新" : `当前版本 ${update.currentVersion}`)}
                  {update.version ? ` · v${update.version}` : ""}
                  {update.status === "downloading" && typeof update.percent === "number" ? ` · ${update.percent}%` : ""}
                </p>
              </div>
              {isPortableManualUpdate(update) ? (
                <button type="button" onClick={openDownloadPage} style={updateButtonStyle}>打开下载页</button>
              ) : update.status === "downloaded" ? (
                <button type="button" onClick={() => void installUpdate()} disabled={updateBusy} style={updateButtonStyle}>重启安装</button>
              ) : (
                <button type="button" onClick={() => void checkUpdates()} disabled={updateBusy || update.status === "checking" || update.status === "downloading"} style={updateButtonStyle}>
                  {updateBusy || update.status === "checking" ? "检查中" : update.status === "downloading" ? "下载中" : "检查更新"}
                </button>
              )}
            </div>
            {update.status === "downloading" && typeof update.percent === "number" && (
              <progress max={100} value={update.percent} aria-label="更新下载进度" style={{ display: "block", width: "100%", height: 4, marginTop: 12, accentColor: "#161616" }} />
            )}
          </section>
        )}
        <button type="button" onClick={() => { window.location.hash = "/settings"; }} style={{ marginTop: 20, minHeight: 40, border: 0, borderRadius: 8, padding: "0 16px", background: "#191918", color: "white", cursor: "pointer" }}>
          打开助手设置
        </button>
      </main>
    </div>
  );
}

const updateButtonStyle: React.CSSProperties = {
  minHeight: 36,
  flexShrink: 0,
  border: 0,
  borderRadius: 7,
  padding: "0 12px",
  background: "#191918",
  color: "white",
  cursor: "pointer",
};

export default function App() {
  return <AppShell />;
}
