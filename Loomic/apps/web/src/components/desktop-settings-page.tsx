"use client";

import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, FolderOpen, LogOut, Moon, RefreshCw, Sun, Laptop, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { clearLocalAssetFolder, chooseLocalAssetFolder, getLocalAssetFolderState } from "@/lib/local-asset-storage";
import { CreditUsageHistory } from "@/components/credits/credit-usage-history";
import { useDesktopToast } from "@/components/desktop-toast";
import {
  formatDesktopCopy,
  useDesktopCopy,
  type DesktopCopy,
  type DesktopLocale,
} from "@/lib/desktop-copy";

type DesktopUpdateState = {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
};

type DesktopSettingsApi = {
  getAppVersion: () => Promise<string>;
  getPlatform: () => string;
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdates: () => Promise<DesktopUpdateState>;
  installUpdate: () => Promise<{ ok: boolean }>;
  onUpdateState: (callback: (state: DesktopUpdateState) => void) => () => void;
};

type FolderState = Awaited<ReturnType<typeof getLocalAssetFolderState>>;

function desktopApi() {
  return typeof window === "undefined"
    ? undefined
    : (window as Window & { electronAPI?: DesktopSettingsApi }).electronAPI;
}

function platformName(platform: string) {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return platform;
}

function updateLabel(state: DesktopUpdateState, copy: DesktopCopy["settings"]) {
  if (state.message) return state.message;
  if (state.status === "checking") return copy.updateChecking;
  if (state.status === "available") return formatDesktopCopy(copy.updateAvailable, { version: state.version ?? copy.newVersion });
  if (state.status === "downloading") {
    return typeof state.percent === "number"
      ? formatDesktopCopy(copy.updateDownloadingPercent, { percent: state.percent })
      : copy.updateDownloading;
  }
  if (state.status === "downloaded") return formatDesktopCopy(copy.updateDownloaded, { version: state.version ?? copy.newVersion });
  if (state.status === "not-available") return copy.updateLatest;
  if (state.status === "error") return copy.updateError;
  return formatDesktopCopy(copy.updateCurrent, { version: state.currentVersion });
}

export function DesktopSettingsPage({ locale }: { locale?: DesktopLocale | null } = {}) {
  const { copy } = useDesktopCopy(locale);
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const toast = useDesktopToast();
  const api = desktopApi();
  const [version, setVersion] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [update, setUpdate] = useState<DesktopUpdateState | null>(null);
  const [folder, setFolder] = useState<FolderState>({ name: null, permission: "unselected" });
  const [folderLoading, setFolderLoading] = useState(true);
  const [folderBusy, setFolderBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshFolder = useCallback(async () => {
    setFolderLoading(true);
    try {
      setFolder(await getLocalAssetFolderState());
    } finally {
      setFolderLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshFolder().catch((cause) => {
      const message = cause instanceof Error ? cause.message : copy.settings.folderReadFailed;
      const failure = formatDesktopCopy(copy.settings.folderReadFailToast, { reason: message });
      setError(failure);
      toast.push({ tone: "error", message: failure, key: "settings:folder-load" });
    });
  }, [copy, refreshFolder, toast]);

  useEffect(() => {
    if (!api) return;
    void api.getAppVersion().then(setVersion).catch((cause) => {
      const message = cause instanceof Error ? cause.message : copy.settings.versionReadFailed;
      const failure = formatDesktopCopy(copy.settings.versionReadFailToast, { reason: message });
      setError(failure);
      toast.push({ tone: "error", message: failure, key: "settings:version-load" });
    });
    setPlatform(api.getPlatform());
    void api.getUpdateState().then(setUpdate).catch((cause) => {
      const message = cause instanceof Error ? cause.message : copy.settings.updateStateReadFailed;
      const failure = formatDesktopCopy(copy.settings.updateStateReadFailToast, { reason: message });
      setError(failure);
      toast.push({ tone: "error", message: failure, key: "settings:update-state" });
    });
    return api.onUpdateState(setUpdate);
  }, [api, copy, toast]);

  // A downloaded update only takes effect after the client restarts. The row used to
  // flip to "已下载" with no explanation, so say it once, out loud.
  useEffect(() => {
    if (update?.status !== "downloaded") return;
    toast.push({ tone: "info", message: copy.settings.updateRestart, key: "settings:update-restart" });
  }, [copy, update?.status, toast]);

  async function chooseFolder() {
    setFolderBusy(true);
    setError(null);
    try {
      await chooseLocalAssetFolder();
      await refreshFolder();
      toast.push({ tone: "success", message: copy.settings.folderChosen, key: "settings:folder-chosen" });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      const message = cause instanceof Error ? cause.message : copy.settings.folderChooseFailed;
      const failure = formatDesktopCopy(copy.settings.folderChooseFailToast, { reason: message });
      setError(failure);
      toast.push({ tone: "error", message: failure, key: "settings:folder-choose" });
    } finally {
      setFolderBusy(false);
    }
  }

  async function forgetFolder() {
    setFolderBusy(true);
    setError(null);
    try {
      await clearLocalAssetFolder();
      await refreshFolder();
      toast.push({ tone: "success", message: copy.settings.folderCleared, key: "settings:folder-cleared" });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy.settings.folderClearFailed;
      const failure = formatDesktopCopy(copy.settings.folderClearFailToast, { reason: message });
      setError(failure);
      toast.push({ tone: "error", message: failure, key: "settings:folder-clear" });
    } finally {
      setFolderBusy(false);
    }
  }

  async function checkUpdates() {
    if (!api || updateBusy) return;
    setUpdateBusy(true);
    setError(null);
    try {
      const next = await api.checkForUpdates();
      setUpdate(next);
      if (next.status === "error") {
        const message = next.message ?? copy.settings.updateNoReason;
        const failure = formatDesktopCopy(copy.settings.updateCheckFailToast, { reason: message });
        setError(failure);
        toast.push({ tone: "error", message: failure, key: "settings:update-check" });
      } else if (next.status === "available") {
        toast.push({ tone: "success", message: formatDesktopCopy(copy.settings.updateAvailableToast, { version: next.version ?? copy.settings.newVersion }), key: "settings:update-available" });
      } else if (next.status === "not-available") {
        toast.push({ tone: "success", message: copy.settings.updateLatestToast, key: "settings:update-latest" });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy.settings.updateCheckFailed;
      setError(message);
      toast.push({ tone: "error", message: formatDesktopCopy(copy.settings.updateCheckFailToast, { reason: message }), key: "settings:update-check" });
    } finally {
      setUpdateBusy(false);
    }
  }

  async function installUpdate() {
    if (!api || updateBusy) return;
    setUpdateBusy(true);
    setError(null);
    try {
      await api.installUpdate();
      toast.push({ tone: "info", message: copy.settings.installStarted, key: "settings:update-install" });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy.settings.installFailed;
      setError(message);
      toast.push({ tone: "error", message: formatDesktopCopy(copy.settings.installFailToast, { reason: message }), key: "settings:update-install" });
    } finally {
      setUpdateBusy(false);
    }
  }

  async function leaveAccount() {
    setSignOutBusy(true);
    setError(null);
    try {
      await signOut();
      toast.push({ tone: "success", message: copy.settings.signedOut, key: "settings:sign-out" });
      router.replace("/desktop-app/");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy.settings.signOutFailed;
      setError(message);
      toast.push({ tone: "error", message: formatDesktopCopy(copy.settings.signOutFailToast, { reason: message }), key: "settings:sign-out" });
    } finally {
      setSignOutBusy(false);
    }
  }

  const isUpdateBusy = updateBusy || update?.status === "checking" || update?.status === "downloading";
  const permissionLabel = folder.permission === "granted"
    ? copy.settings.permissionGranted
    : folder.permission === "prompt"
      ? copy.settings.permissionPrompt
      : folder.permission === "denied"
        ? copy.settings.permissionDenied
        : copy.settings.permissionUnselected;

  return (
    <main className="desktop-settings">
      <header className="desktop-settings__header">
        <div><p>{copy.settings.headerEyebrow}</p><h1>{copy.settings.headerTitle}</h1><span>{copy.settings.headerSubtitle}</span></div>
        {version ? <span className="desktop-settings__version">v{version}{platform ? ` · ${platformName(platform)}` : ""}</span> : null}
      </header>

      <section className="desktop-settings__section" aria-labelledby="desktop-settings-appearance">
        <div className="desktop-settings__section-heading"><h2 id="desktop-settings-appearance">{copy.settings.appearance}</h2></div>
        <div className="desktop-settings__row">
          <div><strong>{copy.settings.theme}</strong><p>{copy.settings.themeHint}</p></div>
          <div className="desktop-settings__segmented" role="group" aria-label={copy.settings.themeGroupAria}>
            <button type="button" aria-pressed={theme === "system"} onClick={() => setTheme("system")}><Laptop aria-hidden="true" />{copy.settings.themeSystem}</button>
            <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}><Sun aria-hidden="true" />{copy.settings.themeLight}</button>
            <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}><Moon aria-hidden="true" />{copy.settings.themeDark}</button>
          </div>
        </div>
      </section>

      <section className="desktop-settings__section" aria-labelledby="desktop-settings-storage">
        <div className="desktop-settings__section-heading"><h2 id="desktop-settings-storage">{copy.settings.storage}</h2><p>{copy.settings.storageHint}</p></div>
        <div className="desktop-settings__row">
          <div><strong>{copy.settings.folder}</strong><p>{folderLoading ? copy.settings.folderLoading : folder.name ? `${folder.name} · ${permissionLabel}` : copy.settings.folderUnset}</p></div>
          <div className="desktop-settings__actions">
            <button type="button" onClick={() => void chooseFolder()} disabled={folderBusy}><FolderOpen aria-hidden="true" />{folderBusy ? copy.settings.folderBusy : folder.name ? copy.settings.folderChange : copy.settings.folderChoose}</button>
            {folder.name ? <button type="button" onClick={() => void forgetFolder()} disabled={folderBusy} aria-label={copy.settings.folderRemoveAria} title={copy.settings.folderRemoveAria}><Trash2 aria-hidden="true" /></button> : null}
          </div>
        </div>
      </section>

      <section className="desktop-settings__section" aria-labelledby="desktop-settings-account">
        <div className="desktop-settings__section-heading"><h2 id="desktop-settings-account">{copy.settings.account}</h2></div>
        <div className="desktop-settings__row">
          <div><strong>{user?.email ?? copy.settings.defaultAccount}</strong><p>{copy.settings.accountHint}</p></div>
          <button type="button" className="desktop-settings__command" onClick={() => void leaveAccount()} disabled={signOutBusy}><LogOut aria-hidden="true" />{signOutBusy ? copy.settings.signingOut : copy.settings.signOut}</button>
        </div>
      </section>

      <section className="desktop-settings__section desktop-settings__usage" aria-labelledby="desktop-settings-usage">
        <div className="desktop-settings__section-heading"><h2 id="desktop-settings-usage">{copy.settings.usage}</h2><p>{copy.settings.usageHint}</p></div>
        <CreditUsageHistory />
      </section>

      <section className="desktop-settings__section" aria-labelledby="desktop-settings-updates">
        <div className="desktop-settings__section-heading"><h2 id="desktop-settings-updates">{copy.settings.updates}</h2><p>{copy.settings.updatesHint}</p></div>
        <div className="desktop-settings__row">
          <div><strong>{update ? updateLabel(update, copy.settings) : copy.settings.updateReadingState}</strong><p>{version ? formatDesktopCopy(copy.settings.currentVersion, { version }) : copy.settings.updateReadingVersion}</p></div>
          {update?.status === "downloaded"
            ? <button type="button" className="desktop-settings__command" onClick={() => void installUpdate()} disabled={isUpdateBusy}><RefreshCw aria-hidden="true" />{copy.settings.restartInstall}</button>
            : <button type="button" className="desktop-settings__command" onClick={() => void checkUpdates()} disabled={!api || isUpdateBusy}><RefreshCw aria-hidden="true" />{isUpdateBusy ? copy.settings.updateCheckingBusy : copy.settings.checkUpdates}</button>}
        </div>
        {update?.status === "downloading" && typeof update.percent === "number" ? <progress className="desktop-settings__progress" max={100} value={update.percent} aria-label={copy.settings.progressAria} /> : null}
      </section>

      <section className="desktop-settings__section" aria-labelledby="desktop-settings-advanced">
        <div className="desktop-settings__section-heading"><h2 id="desktop-settings-advanced">{copy.settings.advanced}</h2><p>{copy.settings.advancedHint}</p></div>
        <div className="desktop-settings__links">
          <button type="button" onClick={() => router.push("/desktop-app/mcp/")}><span><strong>{copy.settings.linkMcp}</strong><small>{copy.settings.linkMcpHint}</small></span><ArrowRight aria-hidden="true" /></button>
          <button type="button" onClick={() => router.push("/desktop-app/development/")}><span><strong>{copy.settings.linkDev}</strong><small>{copy.settings.linkDevHint}</small></span><ArrowRight aria-hidden="true" /></button>
          <button type="button" onClick={() => router.push("/desktop-app/")}><span><strong>{copy.settings.linkBrowser}</strong><small>{copy.settings.linkBrowserHint}</small></span><ArrowRight aria-hidden="true" /></button>
        </div>
      </section>
      {error ? <p className="desktop-settings__error" role="alert">{error}</p> : null}
    </main>
  );
}
