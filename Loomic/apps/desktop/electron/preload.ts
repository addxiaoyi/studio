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

// Type declarations for the exposed API
declare global {
  interface Window {
    electronAPI?: {
      onNavigate: (callback: (path: string) => void) => void;
      onNewProject: (callback: () => void) => void;
      onExportCanvas: (callback: () => void) => void;
      minimizeWindow: () => Promise<void>;
      maximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      isBrowserLoginAvailable: () => Promise<boolean>;
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
    };
  }
}
