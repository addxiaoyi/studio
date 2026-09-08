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
});

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
    };
  }
}
