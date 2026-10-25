import { contextBridge, ipcRenderer } from "electron";

function markDesktopShell() {
  document.documentElement?.setAttribute("data-helstera-desktop", "true");
}

if (document.documentElement) markDesktopShell();
else
  document.addEventListener("DOMContentLoaded", markDesktopShell, {
    once: true,
  });

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Navigation
  onNavigate: (callback: (path: string) => void) => {
    ipcRenderer.on("navigate", (_, path) => callback(path));
  },

  // New project
  onNewProject: (callback: () => void) => {
    ipcRenderer.on("new-project", callback);
  },

  // Export canvas
  onExportCanvas: (callback: () => void) => {
    ipcRenderer.on("export-canvas", callback);
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke("window-minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window-maximize"),
  closeWindow: () => ipcRenderer.invoke("window-close"),
  isBrowserLoginAvailable: () =>
    ipcRenderer.invoke("desktop.browser-login-available"),
  getBrowserLoginStatus: () =>
    ipcRenderer.invoke("desktop.browser-login-status"),
  openBrowserPairing: (pairing: { pairingId: string; code?: string; expiresAt: string; wssUrl: string; disclosure: string }) =>
    ipcRenderer.invoke("desktop.open-browser-pairing", pairing),
  startBrowserLogin: () => ipcRenderer.invoke("desktop.start-browser-login"),
  cancelBrowserLogin: () => ipcRenderer.invoke("desktop.cancel-browser-login"),
  finishBrowserLogin: (success: boolean) =>
    ipcRenderer.invoke("desktop.finish-browser-login", success),
  onBrowserLoginState: (
    callback: (state: { status: DesktopLoginStatus }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: { status: DesktopLoginStatus },
    ) => callback(state);
    ipcRenderer.on("desktop:login-state", listener);
    return () => ipcRenderer.removeListener("desktop:login-state", listener);
  },
  getWindowState: () => ipcRenderer.invoke("window-state"),
  getNavigationState: () => ipcRenderer.invoke("desktop.navigation-state"),
  navigateHistory: (direction: "back" | "forward") =>
    ipcRenderer.invoke("desktop.navigate-history", direction),
  onNavigationState: (
    callback: (state: { canGoBack: boolean; canGoForward: boolean }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: { canGoBack: boolean; canGoForward: boolean },
    ) => callback(state);
    ipcRenderer.on("desktop:navigation-state", listener);
    return () =>
      ipcRenderer.removeListener("desktop:navigation-state", listener);
  },
  onWindowState: (callback: (state: { isMaximized: boolean }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: { isMaximized: boolean },
    ) => callback(state);
    ipcRenderer.on("window-state-changed", listener);
    return () => ipcRenderer.removeListener("window-state-changed", listener);
  },

  // App info
  getAppVersion: () => ipcRenderer.invoke("app-version"),
  getPlatform: () => process.platform,
  getUpdateState: () => ipcRenderer.invoke("desktop.update-state"),
  checkForUpdates: () => ipcRenderer.invoke("desktop.check-updates"),
  installUpdate: () => ipcRenderer.invoke("desktop.install-update"),
  onUpdateState: (callback: (state: DesktopUpdateState) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: DesktopUpdateState,
    ) => callback(state);
    ipcRenderer.on("desktop:update-state", listener);
    return () => ipcRenderer.removeListener("desktop:update-state", listener);
  },
  openEmbeddedBrowser: (url: string) =>
    ipcRenderer.invoke("assistant.open-embedded", url),
  connectEmbeddedAssistant: (input: { wssUrl: string; code: string }) =>
    ipcRenderer.invoke("assistant.connect-embedded", input),
  disconnectEmbeddedAssistant: () =>
    ipcRenderer.invoke("assistant.disconnect-embedded"),
  closeEmbeddedBrowser: () => ipcRenderer.invoke("assistant.close-embedded"),
  selectWorkspace: () => ipcRenderer.invoke("workspace.select"),
  getWorkspaceTree: () => ipcRenderer.invoke("workspace.tree"),
  readWorkspaceFile: (path: string) => ipcRenderer.invoke("workspace.read", path),
  writeWorkspaceFile: (input: { path: string; content: string }) => ipcRenderer.invoke("workspace.write", input),
  restoreWorkspaceSnapshot: (snapshotId: string) => ipcRenderer.invoke("workspace.restore", snapshotId),
  getWorkspaceGitStatus: () => ipcRenderer.invoke("workspace.git-status"),
  getWorkspaceGitDiff: (path?: string) => ipcRenderer.invoke("workspace.git-diff", path),
  getWorkspaceScripts: () => ipcRenderer.invoke("workspace.scripts"),
  runWorkspaceScript: (name: string) => ipcRenderer.invoke("workspace.run-script", name),
  cancelWorkspaceScript: (runId: string) => ipcRenderer.invoke("workspace.cancel-script", runId),
  getMcpServers: () => ipcRenderer.invoke("mcp.list"),
  addMcpServer: (input: McpServerInput) => ipcRenderer.invoke("mcp.add", input),
  connectMcpServer: (id: string) => ipcRenderer.invoke("mcp.connect", id),
  disconnectMcpServer: (id: string) => ipcRenderer.invoke("mcp.disconnect", id),
  removeMcpServer: (id: string) => ipcRenderer.invoke("mcp.remove", id),
  callMcpTool: (input: { id: string; name: string; arguments: string }) => ipcRenderer.invoke("mcp.call", input),
  onWorkspaceScriptOutput: (callback: (event: { runId: string; chunk: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: { runId: string; chunk: string }) => callback(value);
    ipcRenderer.on("workspace:script-output", listener);
    return () => ipcRenderer.removeListener("workspace:script-output", listener);
  },
  onWorkspaceScriptFinished: (callback: (event: { runId: string; ok: boolean; exitCode?: number; message?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: { runId: string; ok: boolean; exitCode?: number; message?: string }) => callback(value);
    ipcRenderer.on("workspace:script-finished", listener);
    return () => ipcRenderer.removeListener("workspace:script-finished", listener);
  },
  onAgentEvent: (callback: (event: Record<string, unknown>) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: Record<string, unknown>) => callback(value);
    ipcRenderer.on("desktop:agent-event", listener);
    return () => ipcRenderer.removeListener("desktop:agent-event", listener);
  },
});

type DesktopUpdateState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "not-available"
    | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
};

type DesktopLoginStatus =
  | "waiting"
  | "exchanging"
  | "completed"
  | "failed"
  | "canceled"
  | "expired";

type WorkspaceEntry = { name: string; path: string; kind: "directory" | "file"; size?: number };
type WorkspaceScript = { name: string; manager: "pnpm" | "npm" | "yarn" };
type McpServerInput = {
  name: string; transport: "stdio" | "http"; command?: string; args?: string[];
  cwd?: string; env?: Record<string, string>; url?: string; token?: string;
};
type McpTool = { name: string; description?: string; inputSchema: { type: "object"; properties?: Record<string, object>; required?: string[] }; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean } };
type McpServer = { id: string; name: string; transport: "stdio" | "http"; command?: string; args?: string[]; cwd?: string; url?: string; connected: boolean; tools: McpTool[] };

// Type declarations for the exposed API
declare global {
  interface Window {
    electronAPI?: {
      onNavigate: (callback: (path: string) => void) => void;
      onNewProject: (callback: () => void) => void;
      onExportCanvas: (callback: () => void) => void;
      minimizeWindow: () => Promise<void>;
      maximizeWindow: () => Promise<{ isMaximized: boolean }>;
      closeWindow: () => Promise<void>;
      isBrowserLoginAvailable: () => Promise<boolean>;
      getBrowserLoginStatus: () => Promise<{ status: DesktopLoginStatus }>;
      openBrowserPairing: (pairing: { pairingId: string; code?: string; expiresAt: string; wssUrl: string; disclosure: string }) => Promise<{ ok: boolean; url: string }>;
      startBrowserLogin: () => Promise<{ ok: boolean; message?: string }>;
      cancelBrowserLogin: () => Promise<{ ok: boolean }>;
      finishBrowserLogin: (success: boolean) => Promise<{ ok: boolean }>;
      onBrowserLoginState: (
        callback: (state: { status: DesktopLoginStatus }) => void,
      ) => () => void;
      getWindowState: () => Promise<{ isMaximized: boolean }>;
      getNavigationState: () => Promise<{
        canGoBack: boolean;
        canGoForward: boolean;
      }>;
      navigateHistory: (
        direction: "back" | "forward",
      ) => Promise<{ canGoBack: boolean; canGoForward: boolean }>;
      onNavigationState: (
        callback: (state: {
          canGoBack: boolean;
          canGoForward: boolean;
        }) => void,
      ) => () => void;
      onWindowState: (
        callback: (state: { isMaximized: boolean }) => void,
      ) => () => void;
      getAppVersion: () => Promise<string>;
      getPlatform: () => string;
      getUpdateState: () => Promise<DesktopUpdateState>;
      checkForUpdates: () => Promise<DesktopUpdateState>;
      installUpdate: () => Promise<{ ok: boolean }>;
      onUpdateState: (
        callback: (state: DesktopUpdateState) => void,
      ) => () => void;
      openEmbeddedBrowser: (url: string) => Promise<{ ok: boolean }>;
      connectEmbeddedAssistant: (input: {
        wssUrl: string;
        code: string;
      }) => Promise<{ ok: boolean; message?: string }>;
      disconnectEmbeddedAssistant: () => Promise<{ ok: boolean }>;
      closeEmbeddedBrowser: () => Promise<{ ok: boolean }>;
      selectWorkspace: () => Promise<{ root: string; entries: WorkspaceEntry[] } | null>;
      getWorkspaceTree: () => Promise<WorkspaceEntry[]>;
      readWorkspaceFile: (path: string) => Promise<{ path: string; content: string; size: number }>;
      writeWorkspaceFile: (input: { path: string; content: string }) => Promise<{ path: string; snapshotId: string; bytes: number }>;
      restoreWorkspaceSnapshot: (snapshotId: string) => Promise<{ path: string; restored: boolean }>;
      getWorkspaceGitStatus: () => Promise<string>;
      getWorkspaceGitDiff: (path?: string) => Promise<string>;
      getWorkspaceScripts: () => Promise<WorkspaceScript[]>;
      runWorkspaceScript: (name: string) => Promise<{ runId: string }>;
      cancelWorkspaceScript: (runId: string) => Promise<{ canceled: boolean }>;
      getMcpServers: () => Promise<McpServer[]>;
      addMcpServer: (input: McpServerInput) => Promise<{ id: string }>;
      connectMcpServer: (id: string) => Promise<McpServer[]>;
      disconnectMcpServer: (id: string) => Promise<McpServer[]>;
      removeMcpServer: (id: string) => Promise<McpServer[]>;
      callMcpTool: (input: { id: string; name: string; arguments: string }) => Promise<string>;
      onWorkspaceScriptOutput: (callback: (event: { runId: string; chunk: string }) => void) => () => void;
      onWorkspaceScriptFinished: (callback: (event: { runId: string; ok: boolean; exitCode?: number; message?: string }) => void) => () => void;
      onAgentEvent: (callback: (event: Record<string, unknown>) => void) => () => void;
    };
  }
}
