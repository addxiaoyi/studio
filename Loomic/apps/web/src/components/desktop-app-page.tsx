"use client";

import { ArrowRight, ArrowUpRight, Blocks, Clapperboard, Copy, FileImage, Globe2, Images, LoaderCircle, MonitorPlay, PlugZap, Sparkles, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import type { WebsiteCaptureAssistantConnection, WebsiteCapturePairing } from "@helstera/shared";

import { DesktopMcpPanel } from "@/components/desktop-mcp-panel";
import { DesktopSettingsPage } from "@/components/desktop-settings-page";
import { DesktopWorkbench } from "@/components/desktop-workbench";
import { Button } from "@/components/ui/button";
import ProjectsPage from "@/app/(workspace)/projects/page";
import AssetsPage from "@/app/(workspace)/assets/page";
import CanvasPage from "@/app/canvas/page";
import { useAuth } from "@/lib/auth-context";
import { createProject, createWebsiteCapturePairing, fetchWebsiteAssistantConnection, revokeWebsiteAssistant, setWebsiteAssistantPaused } from "@/lib/server-api";

type LoginStatus = "waiting" | "exchanging" | "completed" | "failed" | "canceled" | "expired";
type BrowserMode = "isolated_browser" | "connected_browser_tab" | "windows_ui" | "visual_ocr";
type DesktopApi = {
  startBrowserLogin: () => Promise<{ ok: boolean; message?: string }>;
  cancelBrowserLogin: () => Promise<{ ok: boolean }>;
  getBrowserLoginStatus: () => Promise<{ status: LoginStatus }>;
  connectEmbeddedAssistant: (input: { wssUrl: string; code: string }) => Promise<{ ok: boolean; message?: string }>;
  openBrowserPairing: (pairing: WebsiteCapturePairing) => Promise<{ ok: boolean; url: string }>;
  onBrowserLoginState: (callback: (state: { status: LoginStatus }) => void) => () => void;
};

const taskTemplates = [
  { id: "tour", label: "介绍一个网站", prompt: "请介绍这个网站的定位、主要页面和核心功能，并附上关键页面截图。", icon: Globe2 },
  { id: "record", label: "录制网站介绍", prompt: "请浏览这个网站，整理主要用户路径，准备一份网站介绍和录屏草稿。", icon: MonitorPlay },
  { id: "assets", label: "整理网页素材", prompt: "请从当前网页整理与目标相关的公开素材，列出来源、用途和需要我确认的操作。", icon: Images },
  { id: "video", label: "剪辑视频草稿", prompt: "请根据当前素材拟一份短视频剪辑方案和时间线草稿，不要发布。", icon: Clapperboard },
  { id: "repeat", label: "完成重复网页操作", prompt: "请检查当前网页并完成可安全自动化的重复步骤。任何提交或会产生外部影响的动作先向我确认。", icon: FileImage },
] as const;

function desktopApi() {
  return (window as Window & { electronAPI?: DesktopApi }).electronAPI;
}

function isDesktopShell() {
  return typeof document !== "undefined" && document.documentElement.dataset.helsteraDesktop === "true";
}

export function DesktopAppPage({ mode }: { mode: "home" | "canvas" | "projects" | "assets" | "mcp" | "development" | "settings" }) {
  const { user, session, loading } = useAuth();
  const router = useRouter();
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<LoginStatus | null>(null);

  useEffect(() => {
    if (!isDesktopShell()) router.replace("/home/");
  }, [router]);

  useEffect(() => {
    const api = desktopApi();
    if (!api) return;
    let receivedEvent = false;
    const unsubscribe = api.onBrowserLoginState(({ status }) => {
      receivedEvent = true;
      setLoginStatus(status);
    });
    void api.getBrowserLoginStatus().then(({ status }) => {
      if (!receivedEvent) setLoginStatus(status);
    }).catch((cause) => {
      setLoginError(cause instanceof Error ? cause.message : "无法读取桌面登录状态。");
    });
    return unsubscribe;
  }, []);

  async function startLogin() {
    const api = desktopApi();
    if (!api || loginBusy) {
      setLoginError("请在 Helstera Desktop 应用中发起登录。");
      return;
    }
    setLoginBusy(true);
    setLoginError(null);
    try {
      const response = await api.startBrowserLogin();
      if (!response.ok) {
        setLoginError(response.message ?? "暂时无法打开浏览器登录。");
        setLoginStatus("failed");
      }
    } catch (cause) {
      setLoginError(cause instanceof Error ? cause.message : "暂时无法打开浏览器登录。");
      setLoginStatus("failed");
    } finally {
      setLoginBusy(false);
    }
  }

  async function cancelLogin() {
    const api = desktopApi();
    if (!api) return;
    try {
      await api.cancelBrowserLogin();
      setLoginStatus("canceled");
    } catch (cause) {
      setLoginError(cause instanceof Error ? cause.message : "取消登录失败，请重试。");
    }
  }

  if (!isDesktopShell()) return null;
  if (loading) return <DesktopLoading />;
  if (!user) {
    const waiting = loginStatus === "waiting" || loginStatus === "exchanging";
    return <main className="desktop-app-login"><section><div className="desktop-app-login__mark"><Sparkles aria-hidden="true" /></div><p className="desktop-command-center__eyebrow">HELSTERA DESKTOP</p><h1>桌面 AI 工作台</h1><p>在系统浏览器完成登录，确认后将自动返回桌面。浏览器 Cookie 不会传给桌面应用。</p><Button size="lg" disabled={loginBusy || waiting} onClick={startLogin}>{loginBusy ? "正在打开浏览器…" : waiting ? "等待浏览器确认…" : loginStatus === "failed" || loginStatus === "expired" || loginStatus === "canceled" ? "重新发起登录" : "登录并进入工作台"}<ArrowUpRight aria-hidden="true" /></Button>{waiting ? <Button variant="outline" className="mt-3 w-full" onClick={cancelLogin}>取消登录</Button> : null}{loginStatus ? <p className="desktop-app-login__status" role="status">{loginStatus === "waiting" ? "已打开系统浏览器，请完成登录。" : loginStatus === "exchanging" ? "正在安全完成桌面登录…" : loginStatus === "completed" ? "登录成功，正在返回桌面…" : "登录请求已结束，请重新发起。"}</p> : null}{loginError ? <p role="alert" className="desktop-home__error">{loginError}</p> : null}</section></main>;
  }

  if (mode === "canvas") return <DesktopModule active="canvas"><Suspense fallback={<DesktopLoading />}><CanvasPage /></Suspense></DesktopModule>;
  if (mode === "projects") return <DesktopModule active="projects"><Suspense fallback={<DesktopLoading />}><ProjectsPage /></Suspense></DesktopModule>;
  if (mode === "assets") return <DesktopModule active="assets"><Suspense fallback={<DesktopLoading />}><AssetsPage /></Suspense></DesktopModule>;
  if (mode === "settings") return <DesktopSettingsPage />;
  if (mode === "mcp") return <DesktopAdvancedPage initialView="mcp" />;
  if (mode === "development") return <DesktopAdvancedPage initialView="development" />;
  return <DesktopAgentHome email={user.email} accessToken={session?.access_token ?? ""} />;
}

function DesktopAgentHome({ email, accessToken }: { email: string; accessToken: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [browserMode, setBrowserMode] = useState<BrowserMode>("isolated_browser");
  const [browserConnection, setBrowserConnection] = useState<WebsiteCaptureAssistantConnection | null>(null);
  const [browserStatusLoading, setBrowserStatusLoading] = useState(false);
  const [pairing, setPairing] = useState<WebsiteCapturePairing | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desktopRuntimeError, setDesktopRuntimeError] = useState<string | null>(null);
  const desktopRuntimeStarted = useRef(false);

  useEffect(() => {
    if (!accessToken || desktopRuntimeStarted.current) return;
    const api = desktopApi();
    if (!api) return;
    desktopRuntimeStarted.current = true;
    void createWebsiteCapturePairing(accessToken)
      .then((pairing) => api.connectEmbeddedAssistant({ wssUrl: pairing.wssUrl, code: pairing.code ?? "" }))
      .then((connection) => {
        if (!connection.ok) throw new Error(connection.message ?? "桌面 Agent 本机连接未建立。");
      })
      .catch((cause) => {
        desktopRuntimeStarted.current = false;
        setDesktopRuntimeError(cause instanceof Error ? cause.message : "桌面 Agent 本机连接失败。");
      });
  }, [accessToken]);

  const refreshBrowserConnection = useCallback(async () => {
    if (!accessToken) return;
    setBrowserStatusLoading(true);
    try {
      const connection = await fetchWebsiteAssistantConnection(accessToken);
      setBrowserConnection(connection);
      if (connection?.status === "connected") {
        setPairing(null);
        setPairingUrl(null);
        setBrowserError(null);
      }
    } catch (cause) {
      setBrowserError(cause instanceof Error ? cause.message : "无法读取浏览器连接状态。");
    } finally {
      setBrowserStatusLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (browserMode !== "connected_browser_tab") return;
    void refreshBrowserConnection();
    const timer = window.setInterval(() => void refreshBrowserConnection(), 3_000);
    return () => window.clearInterval(timer);
  }, [browserMode, refreshBrowserConnection]);

  useEffect(() => {
    if (!pairing || browserConnection?.status === "connected") return;
    const timer = window.setTimeout(() => {
      setBrowserError((current) => current ?? "尚未检测到浏览器助手。请确认 Helstera Local Browser Assistant 已安装并启用，然后重新连接。");
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, [pairing, browserConnection?.status]);

  async function connectBrowserAssistant() {
    if (pairingBusy) return;
    const api = desktopApi();
    if (!api) {
      setBrowserError("请在 Helstera Desktop 中连接浏览器助手。");
      return;
    }

    setPairingBusy(true);
    setBrowserError(null);
    try {
      const existing = await fetchWebsiteAssistantConnection(accessToken);
      if (existing?.status === "connected") {
        setBrowserConnection(existing);
        setPairing(null);
        return;
      }
      const nextPairing = await createWebsiteCapturePairing(accessToken);
      setPairing(nextPairing);
      const opened = await api.openBrowserPairing(nextPairing);
      setPairingUrl(opened.url);
      void refreshBrowserConnection();
    } catch (cause) {
      setBrowserError(cause instanceof Error ? cause.message : "无法发起浏览器配对，请重试。");
    } finally {
      setPairingBusy(false);
    }
  }

  async function resumeBrowserAssistant() {
    if (!accessToken || pairingBusy) return;
    setPairingBusy(true);
    try {
      setBrowserConnection(await setWebsiteAssistantPaused(accessToken, false));
      setBrowserError(null);
    } catch (cause) {
      setBrowserError(cause instanceof Error ? cause.message : "无法恢复浏览器连接。");
    } finally {
      setPairingBusy(false);
    }
  }

  async function disconnectBrowserAssistant() {
    if (!accessToken || pairingBusy) return;
    setPairingBusy(true);
    try {
      await revokeWebsiteAssistant(accessToken);
      setBrowserConnection(null);
      setPairing(null);
      setPairingUrl(null);
      setBrowserError(null);
    } catch (cause) {
      setBrowserError(cause instanceof Error ? cause.message : "无法断开浏览器连接。");
    } finally {
      setPairingBusy(false);
    }
  }

  async function startAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const goal = prompt.trim();
    if (!goal || !accessToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const needsBrowser = /(?:https?:\/\/|\b(?:website|webpage|browser|chrome|edge|url)\b|网站|网页|浏览器|标签页|网址)/iu.test(goal);
      if (browserMode === "connected_browser_tab" && needsBrowser) {
        const connection = await fetchWebsiteAssistantConnection(accessToken);
        setBrowserConnection(connection);
        if (connection?.status !== "connected") {
          throw new Error("Edge / Chrome 浏览器尚未连接。先完成一键配对，再回来启动任务。");
        }
      }
      const project = await createProject(accessToken, {
        name: goal.length > 48 ? `${goal.slice(0, 45)}…` : goal,
      }, { idempotencyKey: crypto.randomUUID() });
      const query = new URLSearchParams({
        id: project.project.primaryCanvas.id,
        prompt: goal,
        browserMode,
      });
      router.replace(`/desktop-app/canvas/?${query.toString()}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法创建任务，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function copyPairingUrl() {
    if (!pairingUrl) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
      setBrowserError("一次性配对链接已复制，可粘贴到隔离 Edge 窗口。");
    } catch (cause) {
      setBrowserError(cause instanceof Error ? cause.message : "无法复制配对链接。");
    }
  }

  function chooseTemplate(template: typeof taskTemplates[number]) {
    setPrompt(template.prompt);
    document.getElementById("desktop-agent-prompt")?.focus();
  }

  return <main className="desktop-agent-home">
    <header className="desktop-agent-home__header"><div><p className="desktop-command-center__eyebrow">HELSTERA DESKTOP / AGENT</p><h1>你想让 Agent 帮你做什么？</h1><p>用一句话描述目标。浏览器、屏幕与视觉能力由 Agent 按任务需要自动调度。</p></div><div className="desktop-command-center__identity"><span className="desktop-command-center__status" />{email}<span>已连接</span></div></header>
    <section className="desktop-agent-composer" aria-label="与 Agent 对话"><form onSubmit={startAgent}><label htmlFor="desktop-agent-prompt">任务目标</label><textarea id="desktop-agent-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：打开 https://example.com，介绍产品功能并整理关键页面截图。" rows={4} maxLength={4000} disabled={busy} /><div className="desktop-agent-composer__footer"><fieldset><legend>浏览器访问方式</legend><button type="button" role="radio" aria-checked={browserMode === "isolated_browser"} className={browserMode === "isolated_browser" ? "is-selected" : ""} onClick={() => setBrowserMode("isolated_browser")}>隔离浏览器</button><button type="button" role="radio" aria-checked={browserMode === "connected_browser_tab"} className={browserMode === "connected_browser_tab" ? "is-selected" : ""} onClick={() => setBrowserMode("connected_browser_tab")}>授权的 Edge / Chrome 标签页</button><button type="button" role="radio" aria-checked={browserMode === "windows_ui"} className={browserMode === "windows_ui" ? "is-selected" : ""} onClick={() => setBrowserMode("windows_ui")}>本机应用（控件树）</button><button type="button" role="radio" aria-checked={browserMode === "visual_ocr"} className={browserMode === "visual_ocr" ? "is-selected" : ""} onClick={() => setBrowserMode("visual_ocr")}>本机应用（视觉 OCR）</button></fieldset><Button type="submit" disabled={busy || !prompt.trim() || !accessToken}>{busy ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在准备任务…</> : <>开始任务<ArrowRight aria-hidden="true" /></>}</Button></div></form>{error ? <p className="desktop-agent-home__error" role="alert">{error}</p> : null}</section>
    {browserMode === "connected_browser_tab" ? <section className="desktop-browser-connection" aria-label="Edge 与 Chrome 连接状态">
      <div className="desktop-browser-connection__status" role="status" aria-live="polite">
        <span className={browserConnection?.status === "connected" ? "is-connected" : "is-disconnected"} aria-hidden="true" />
        <div><strong>{browserStatusLoading && !browserConnection ? "正在检查浏览器…" : browserConnection?.status === "connected" ? `${browserConnection.browser === "edge" ? "Microsoft Edge" : "Chrome"} 已连接` : browserConnection?.status === "paused" ? "浏览器连接已暂停" : "Edge / Chrome 尚未连接"}</strong><small>{browserConnection?.status === "connected" ? "任务会在浏览器当前活动的标签页中执行。" : "连接后，任务开始时会使用当前活动标签页。"}</small></div>
      </div>
      <div className="desktop-browser-connection__actions">
        {browserConnection?.status === "connected" ? <button type="button" onClick={() => void disconnectBrowserAssistant()} disabled={pairingBusy}><WifiOff aria-hidden="true" />断开</button> : browserConnection?.status === "paused" ? <button type="button" onClick={() => void resumeBrowserAssistant()} disabled={pairingBusy}><PlugZap aria-hidden="true" />恢复连接</button> : <Button type="button" variant="outline" onClick={() => void connectBrowserAssistant()} disabled={pairingBusy}>{pairingBusy ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在配对…</> : <><PlugZap aria-hidden="true" />一键连接浏览器</>}</Button>}
        {pairingBusy || browserStatusLoading ? <LoaderCircle className="desktop-browser-connection__spinner animate-spin" aria-label="正在连接" /> : null}
      </div>
      {pairing && browserConnection?.status !== "connected" ? <div className="desktop-browser-connection__hint"><span>已打开一次性配对页，连接码将在 {new Date(pairing.expiresAt).toLocaleTimeString()} 过期。配对后会恢复原活动标签。</span>{pairingUrl ? <button type="button" onClick={() => void copyPairingUrl()}><Copy aria-hidden="true" />复制配对链接</button> : null}</div> : null}
      {browserError ? <p className="desktop-browser-connection__error" role="alert">{browserError}</p> : null}
    </section> : null}
    <section className="desktop-agent-templates" aria-label="任务模板"><div className="desktop-agent-templates__heading"><div><p>START WITH A TASK</p><h2>常用任务</h2></div></div><div className="desktop-agent-templates__list">{taskTemplates.map((template) => { const Icon = template.icon; return <button key={template.id} type="button" onClick={() => chooseTemplate(template)}><Icon aria-hidden="true" /><span>{template.label}</span><ArrowUpRight aria-hidden="true" /></button>; })}</div></section>
    <footer className="desktop-agent-home__footer"><span><Images aria-hidden="true" />截图、录屏草稿与总结会回到画布和素材库</span><button type="button" onClick={() => router.replace("/desktop-app/development/")}><Blocks aria-hidden="true" />高级能力</button></footer>
  </main>;
}

function DesktopAdvancedPage({ initialView }: { initialView: "mcp" | "development" }) {
  const view = initialView;
  const title = view === "mcp" ? "MCP 连接" : "本地开发";
  return <main className="desktop-feature"><section className={`desktop-feature__content desktop-feature__content--${view}`}><h1 className="desktop-feature__page-title">{title}</h1>{view === "mcp" ? <DesktopMcpPanel /> : <DesktopWorkbench />}</section></main>;
}

function DesktopModule({ active, children }: { active: string; children: ReactNode }) {
  if (active === "canvas") return <main className="desktop-canvas-workspace">{children}</main>;
  return <main className="desktop-feature"><section className={`desktop-feature__content desktop-feature__content--${active}`}>{children}</section></main>;
}

function DesktopLoading() { return <div className="desktop-module-loading" aria-busy="true"><span /></div>; }
