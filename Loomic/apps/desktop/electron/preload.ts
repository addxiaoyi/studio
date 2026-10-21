import { contextBridge, ipcRenderer } from "electron";

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

  // App info
  getAppVersion: () => ipcRenderer.invoke("app-version"),
  getPlatform: () => process.platform,
  getUpdateState: () => ipcRenderer.invoke("desktop.update-state"),
  checkForUpdates: () => ipcRenderer.invoke("desktop.check-updates"),
  installUpdate: () => ipcRenderer.invoke("desktop.install-update"),
  onUpdateState: (callback: (state: DesktopUpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState) => callback(state);
    ipcRenderer.on("desktop:update-state", listener);
    return () => ipcRenderer.removeListener("desktop:update-state", listener);
  },
  openEmbeddedBrowser: (url: string) => ipcRenderer.invoke("assistant.open-embedded", url),
  connectEmbeddedAssistant: (input: { wssUrl: string; code: string }) => ipcRenderer.invoke("assistant.connect-embedded", input),
  disconnectEmbeddedAssistant: () => ipcRenderer.invoke("assistant.disconnect-embedded"),
  closeEmbeddedBrowser: () => ipcRenderer.invoke("assistant.close-embedded"),
});

type DesktopUpdateState = {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
};

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
      getAppVersion: () => Promise<string>;
      getPlatform: () => string;
      getUpdateState: () => Promise<DesktopUpdateState>;
      checkForUpdates: () => Promise<DesktopUpdateState>;
      installUpdate: () => Promise<{ ok: boolean }>;
      onUpdateState: (callback: (state: DesktopUpdateState) => void) => () => void;
      openEmbeddedBrowser: (url: string) => Promise<{ ok: boolean }>;
      connectEmbeddedAssistant: (input: { wssUrl: string; code: string }) => Promise<{ ok: boolean; message?: string }>;
      disconnectEmbeddedAssistant: () => Promise<{ ok: boolean }>;
      closeEmbeddedBrowser: () => Promise<{ ok: boolean }>;
    };
  }
}
