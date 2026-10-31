"use client";

import { Cable, CheckCircle2, CircleAlert, LoaderCircle, Power, Puzzle, BookOpen } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { setAgentMarketplaceEnabled } from "@/lib/server-api";

type DesktopExtension = {
  itemId: string;
  name: string;
  slug: string;
  kind: "skill" | "mcp" | "plugin";
  version: string;
  enabled: boolean;
  status: "enabled" | "disabled" | "blocked" | "missing" | "disconnected";
  statusMessage?: string;
  metadata: Record<string, unknown>;
};

type DesktopExtensionApi = {
  getDesktopExtensions?: () => Promise<DesktopExtension[]>;
  setDesktopExtensionEnabled?: (input: { itemId: string; enabled: boolean }) => Promise<DesktopExtension[]>;
  onDesktopExtensionsChanged?: (callback: (extensions: DesktopExtension[]) => void) => () => void;
};

function desktopApi() {
  return typeof window === "undefined"
    ? undefined
    : (window as Window & { electronAPI?: DesktopExtensionApi }).electronAPI;
}

const kindIcon = { skill: BookOpen, mcp: Cable, plugin: Puzzle } as const;
const kindLabel = { skill: "Skill", mcp: "MCP", plugin: "插件" } as const;

function statusLabel(extension: DesktopExtension, english: boolean) {
  if (extension.status === "blocked") return english ? "Blocked by safety policy" : "已被安全策略拦截";
  if (extension.status === "missing") return english ? "Local MCP is missing" : "本机 MCP 未找到";
  if (extension.status === "disconnected") return english ? "Disconnected" : "未连接";
  if (extension.status === "disabled") return english ? "Disabled" : "已停用";
  return english ? "Ready" : "可用";
}

export function DesktopExtensionPanel({ locale }: { locale?: string | null | undefined }) {
  const english = locale === "en-US";
  const { session } = useAuth();
  const api = desktopApi();
  const [extensions, setExtensions] = useState<DesktopExtension[]>([]);
  const [loading, setLoading] = useState(Boolean(api));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api?.getDesktopExtensions) {
      setLoading(false);
      return;
    }
    let active = true;
    void api.getDesktopExtensions()
      .then((next) => { if (active) setExtensions(next); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Extension state unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    const unsubscribe = api.onDesktopExtensionsChanged?.((next) => setExtensions(next)) ?? (() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  async function toggle(extension: DesktopExtension) {
    if (!api?.setDesktopExtensionEnabled || extension.status === "blocked" || extension.status === "missing" || busyId) return;
    setBusyId(extension.itemId);
    setError(null);
    try {
      if (extension.kind !== "mcp") {
        if (!session?.access_token) throw new Error(english ? "Sign in again to update this extension." : "请重新登录后更新扩展状态。");
        await setAgentMarketplaceEnabled(session.access_token, extension.itemId, !extension.enabled);
      }
      setExtensions(await api.setDesktopExtensionEnabled({ itemId: extension.itemId, enabled: !extension.enabled }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (english ? "Could not update the extension." : "无法更新扩展状态。"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="desktop-settings__section desktop-extension-panel" aria-labelledby="desktop-settings-extensions">
      <div className="desktop-settings__section-heading">
        <h2 id="desktop-settings-extensions">{english ? "Agent extensions" : "Agent 扩展"}</h2>
        <p>{english ? "Installed capabilities available to this desktop." : "已安装并接入本机工作台的能力。"}</p>
      </div>
      {!api ? <p className="desktop-extension-panel__empty">{english ? "Open this page in Helstera Desktop to manage local extensions." : "请在 Helstera Desktop 中打开此页面管理本机扩展。"}</p>
        : loading ? <p className="desktop-extension-panel__empty"><LoaderCircle className="animate-spin" aria-hidden="true" />{english ? "Loading extension state..." : "正在读取扩展状态..."}</p>
          : extensions.length === 0 ? <p className="desktop-extension-panel__empty">{english ? "Install an item from the marketplace to make it available here." : "从市场安装扩展后，它会显示在这里并接入 Agent。"}</p>
            : <div className="desktop-extension-panel__list">
              {extensions.map((extension) => {
                const Icon = kindIcon[extension.kind];
                const locked = extension.status === "blocked" || extension.status === "missing";
                return <article className="desktop-extension-panel__item" key={extension.itemId}>
                  <div className="desktop-extension-panel__icon"><Icon aria-hidden="true" /></div>
                  <div className="desktop-extension-panel__main">
                    <div className="desktop-extension-panel__title"><strong>{extension.name}</strong><span>{kindLabel[extension.kind]} · v{extension.version}</span></div>
                    <p className={`desktop-extension-panel__status is-${extension.status}`}>
                      {extension.status === "blocked" || extension.status === "missing" || extension.status === "disconnected" ? <CircleAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                      {statusLabel(extension, english)}{extension.statusMessage ? ` · ${extension.statusMessage}` : ""}
                    </p>
                  </div>
                  <button type="button" className="desktop-extension-panel__toggle" aria-pressed={extension.enabled} disabled={locked || busyId === extension.itemId} onClick={() => void toggle(extension)} title={extension.enabled ? (english ? "Disable" : "停用") : (english ? "Enable" : "启用")}>
                    {busyId === extension.itemId ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Power aria-hidden="true" />}
                    <span>{extension.enabled ? (english ? "On" : "启用") : (english ? "Off" : "停用")}</span>
                  </button>
                </article>;
              })}
            </div>}
      {error ? <p className="desktop-settings__error" role="alert">{error}</p> : null}
    </section>
  );
}
