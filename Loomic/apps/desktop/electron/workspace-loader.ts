import type { BrowserWindow } from "electron";

const LOAD_TIMEOUT_MS = 25_000;
type Failure = "offline" | "timeout" | "crashed";

export class WorkspaceLoader {
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private target: string;
  private recovering = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly recoveryPage: string,
    private readonly home: string,
    private readonly openExternal: (url: string) => Promise<unknown>,
  ) {
    this.target = home;
    window.webContents.on("did-finish-load", this.loaded);
    window.webContents.on("did-fail-load", this.failed);
    window.webContents.on("render-process-gone", this.crashed);
    window.webContents.on("did-start-navigation", this.started);
  }

  private clearTimer = () => { if (this.timer) clearTimeout(this.timer); };
  private armTimeout = () => {
    this.clearTimer();
    this.timer = setTimeout(() => void this.recover("timeout"), LOAD_TIMEOUT_MS);
  };
  private loaded = () => {
    this.clearTimer();
    if (!this.window.isDestroyed()) this.window.show();
  };
  private failed = (_event: unknown, code: number, _description: string, _url: string, mainFrame: boolean) => {
    if (mainFrame && code !== -3 && !this.recovering) void this.recover("offline");
  };
  private crashed = () => { this.recovering = false; void this.recover("crashed"); };
  private started = (_event: unknown, url: string, inPlace: boolean, mainFrame: boolean) => {
    if (!mainFrame || inPlace || !this.isWorkspaceUrl(url)) return;
    this.target = url;
    this.recovering = false;
    this.armTimeout();
  };
  private isWorkspaceUrl(url: string): boolean {
    try { return new URL(url).origin === new URL(this.home).origin; }
    catch { return false; }
  }

  async open(url: string): Promise<void> {
    if (!this.isWorkspaceUrl(url)) throw new Error("Only workspace pages can open in the desktop window.");
    this.target = url;
    this.recovering = false;
    const generation = ++this.generation;
    this.armTimeout();
    try { await this.window.loadURL(url); }
    catch {
      if (generation === this.generation && !this.window.isDestroyed()) await this.recover("offline");
    }
  }

  private async recover(reason: Failure): Promise<void> {
    this.clearTimer();
    if (this.window.isDestroyed() || this.recovering) return;
    this.recovering = true;
    ++this.generation;
    this.window.webContents.stop();
    try {
      await this.window.loadFile(this.recoveryPage, { query: { state: reason } });
      if (!this.window.isDestroyed()) this.window.show();
    } catch { console.error("[workspace-loader] Unable to open the local recovery page."); }
  }

  navigate(url: string): boolean {
    if (!this.recovering || !this.window.webContents.getURL().startsWith("file:")) return false;
    if (url === "helstera://desktop/retry") { void this.open(this.target); return true; }
    if (url === "helstera://desktop/home") { void this.open(this.home); return true; }
    if (url === "helstera://desktop/browser") {
      void this.openExternal(this.target).catch(() => console.warn("[workspace-loader] Cannot open the system browser."));
      return true;
    }
    return false;
  }

  dispose(): void {
    ++this.generation;
    this.clearTimer();
    if (this.window.isDestroyed()) return;
    this.window.webContents.off("did-finish-load", this.loaded);
    this.window.webContents.off("did-fail-load", this.failed);
    this.window.webContents.off("render-process-gone", this.crashed);
    this.window.webContents.off("did-start-navigation", this.started);
  }
}
