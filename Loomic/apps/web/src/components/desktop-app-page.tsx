"use client";

import { ArrowRight, ArrowUpRight, Blocks, Clapperboard, Copy, FileImage, FolderOpen, Globe2, Images, LoaderCircle, Monitor, MonitorPlay, PlugZap, Sparkles, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import type { WebsiteCaptureAssistantConnection, WebsiteCapturePairing } from "@helstera/shared";

import { DesktopMcpPanel } from "@/components/desktop-mcp-panel";
import { AgentMarketplacePage } from "@/components/agent-marketplace-page";
import { DesktopSettingsPage } from "@/components/desktop-settings-page";
import { DesktopWorkbench } from "@/components/desktop-workbench";
import { Button } from "@/components/ui/button";
import ProjectsPage from "@/app/(workspace)/projects/page";
import AssetsPage from "@/app/(workspace)/assets/page";
import CanvasPage from "@/app/canvas/page";
import { useAuth } from "@/lib/auth-context";
import { useLocale, type Locale } from "@/lib/i18n";
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
  { id: "tour", mode: "isolated_browser", label: "介绍一个网站", labelEn: "Introduce a website", prompt: "介绍这个网站的定位、主要页面和核心功能，并整理关键页面截图。", promptEn: "Introduce this website's purpose, main pages, and core features, then collect key screenshots.", icon: Globe2 },
  { id: "record", mode: "isolated_browser", label: "录制网站介绍", labelEn: "Record a website tour", prompt: "浏览这个网站的主要用户路径，准备一份网站介绍和录屏草稿。", promptEn: "Explore the main user journey and prepare a website introduction and recording draft.", icon: MonitorPlay },
  { id: "assets", mode: "connected_browser_tab", label: "整理网页素材", labelEn: "Collect web assets", prompt: "从当前网页整理与项目相关的公开素材，列出来源和用途；有外部影响的操作先询问我。", promptEn: "Collect project-related material from the current page and list its sources and uses. Ask before actions with external effects.", icon: Images },
  { id: "video", mode: "isolated_browser", label: "剪辑视频草稿", labelEn: "Prepare a video draft", prompt: "根据当前素材整理一份短视频剪辑草稿、旁白和时间线，不要发布。", promptEn: "Prepare a short-video edit draft with narration and a timeline. Do not publish it.", icon: Clapperboard },
  { id: "repeat", mode: "connected_browser_tab", label: "完成重复网页操作", labelEn: "Repeat a web workflow", prompt: "观察当前页面，完成可安全自动化的重复步骤。提交或产生外部影响的动作先确认。", promptEn: "Inspect the current page and repeat safe, routine steps. Ask before submitting or causing external effects.", icon: FileImage },
  { id: "local-files", mode: "windows_ui", label: "整理本机文件窗口", labelEn: "Organize a local file window", prompt: "查看当前文件管理器窗口并按我的目标整理文件。先列出拟执行的移动或重命名，再等我确认；不要删除文件。", promptEn: "Inspect the active file manager and organize files toward my goal. List proposed moves or renames and wait for approval; do not delete files.", icon: FolderOpen },
  { id: "desktop-repeat", mode: "windows_ui", label: "在桌面应用中完成操作", labelEn: "Work in a desktop app", prompt: "在当前桌面应用中完成我描述的重复操作。先观察界面；提交、删除或对外发送前逐项询问我。", promptEn: "Complete my routine task in the active desktop app. Inspect the interface first and ask before submitting, deleting, or sending anything.", icon: Monitor },
] as const;

const DESKTOP_COPY = {
  "zh-CN": {
    login: {
      stateError: "无法读取桌面登录状态。", desktopOnly: "请在 Helstera Desktop 应用中发起登录。",
      openError: "暂时无法打开浏览器登录。", cancelError: "取消登录失败，请重试。",
    },
    // 会话加载失败（断网 / 超时 / 5xx）≠ 未登录：这种情况不能渲染登录页。
    // 文案留在本组件的 DESKTOP_COPY 里而不是 `desktop-copy.ts`，因为后者不在本批写入范围。
    sessionFailed: {
      title: "无法连接工作区",
      description: "登录状态未知：网络中断或服务暂时不可用。你的目标不会丢失，恢复后可以继续。",
      retry: "重新连接",
    },
    heading: "你想让 Agent 帮你做什么？", intro: "描述目标，Agent 会按需要调度浏览器、桌面控件和视觉能力。", connected: "已连接",
    goal: "任务目标", placeholder: "例如：打开网站并介绍主要功能，或整理当前文件窗口。", modeLegend: "执行方式",
    modes: { isolated_browser: "隔离浏览器", connected_browser_tab: "授权 Edge / Chrome 标签页", windows_ui: "本机应用（控件树）", visual_ocr: "本机应用（视觉 OCR）" },
    hints: {
      isolated_browser: "用于公开网页，不继承 Edge / Chrome 登录态。",
      connected_browser_tab: "使用已配对扩展操作当前授权标签页。",
      windows_ui: "优先读取辅助功能控件树，适合常规桌面操作。",
      visual_ocr: "控件树无法识别时，使用截图和 OCR 定位。",
    },
    start: "开始任务", preparing: "正在准备任务…", connection: "执行器连接状态", checking: "正在检查连接…",
    desktopConnected: "Helstera Desktop 已连接", extensionConnected: "浏览器扩展已连接", desktopMissing: "桌面 Agent 尚未连接", browserMissing: "Edge / Chrome 尚未连接",
    desktopInfo: "任务会调用桌面应用和本机控件。", browserInfo: "任务会在已授权的活动标签页执行。", notConnected: "连接前不会提交本机操作任务。",
    mismatch: "连接类型与所选执行模式不匹配。请连接对应的浏览器扩展或桌面 Agent。",
    connect: "一键连接浏览器", connecting: "正在配对…", disconnect: "断开", resume: "恢复连接", paused: "连接已暂停",
    pairingTitle: "已打开一次性配对页", pairingExpires: "连接码将在", pairingRestore: "配对后会恢复原活动标签。", copyPairing: "复制配对链接",
    templateTitle: "常用任务", templateEyebrow: "START WITH A TASK", assetFooter: "截图和录屏可保存到本地素材库", advanced: "高级能力",
    desktopRequired: "本机桌面 Agent 尚未连接。请启动 Helstera Desktop 并保持 Agent 工作台运行。",
    browserRequired: "Edge / Chrome 浏览器尚未连接。先完成一键配对，再回来启动任务。",
    startFailed: "无法开始任务，请重试。", connectionFailed: "无法读取连接状态。", pairingFailed: "无法完成浏览器配对。",
    assistantMissing: "未检测到浏览器助手。请安装并启用 Helstera Local Browser Assistant。", pairingCopied: "配对链接已复制，可粘贴到隔离 Edge 窗口。",
  },
  "en-US": {
    login: {
      stateError: "Unable to read desktop sign-in status.", desktopOnly: "Start sign-in from the Helstera Desktop app.",
      openError: "Unable to open browser sign-in.", cancelError: "Unable to cancel sign-in. Please retry.",
    },
    sessionFailed: {
      title: "Workspace unreachable",
      description: "Sign-in state is unknown — the network dropped or the service is temporarily unavailable. Your goal is kept and you can continue once it recovers.",
      retry: "Retry connection",
    },
    heading: "What should your Agent do?", intro: "Describe the goal. The Agent chooses browser, desktop control, and vision tools as needed.", connected: "Connected",
    goal: "Task goal", placeholder: "For example: introduce a website's key features or organize the active file window.", modeLegend: "Execution mode",
    modes: { isolated_browser: "Isolated browser", connected_browser_tab: "Authorized Edge / Chrome tab", windows_ui: "Desktop app (controls)", visual_ocr: "Desktop app (visual OCR)" },
    hints: {
      isolated_browser: "For public websites; does not inherit Edge or Chrome login sessions.",
      connected_browser_tab: "Uses the paired extension on the currently authorized tab.",
      windows_ui: "Reads accessibility controls first for routine desktop work.",
      visual_ocr: "Uses screenshots and OCR when controls cannot be recognized.",
    },
    start: "Start task", preparing: "Preparing task…", connection: "Executor connection", checking: "Checking connection…",
    desktopConnected: "Helstera Desktop connected", extensionConnected: "Browser extension connected", desktopMissing: "Desktop Agent is not connected", browserMissing: "Edge / Chrome is not connected",
    desktopInfo: "Tasks use desktop apps and native controls.", browserInfo: "Tasks run in the authorized active tab.", notConnected: "Local actions cannot start until connected.",
    mismatch: "The connected client does not match this mode. Connect the required browser extension or desktop Agent.",
    connect: "Connect browser", connecting: "Pairing…", disconnect: "Disconnect", resume: "Resume connection", paused: "Connection paused",
    pairingTitle: "One-time pairing page opened", pairingExpires: "The code expires at", pairingRestore: "The active tab will be restored after pairing.", copyPairing: "Copy pairing link",
    templateTitle: "Common tasks", templateEyebrow: "START WITH A TASK", assetFooter: "Screenshots and recordings can be saved to the local library", advanced: "Advanced tools",
    desktopRequired: "Desktop Agent is not connected. Start Helstera Desktop and keep the Agent workspace open.",
    browserRequired: "Edge / Chrome is not connected. Pair it first, then retry the task.",
    startFailed: "Unable to start the task. Please retry.", connectionFailed: "Unable to read connection status.", pairingFailed: "Unable to pair the browser.",
    assistantMissing: "Browser assistant was not detected. Install and enable Helstera Local Browser Assistant.", pairingCopied: "Pairing link copied. Paste it into the isolated Edge window.",
  },
} as const;

function desktopApi() {
  return (window as Window & { electronAPI?: DesktopApi }).electronAPI;
}

function isDesktopShell() {
  return typeof document !== "undefined" && document.documentElement.dataset.helsteraDesktop === "true";
}

export function DesktopAppPage({ mode }: { mode: "home" | "canvas" | "projects" | "assets" | "marketplace" | "mcp" | "development" | "settings" }) {
  const { user, session, loading, sessionError, retrySession } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const copy = DESKTOP_COPY[locale];
  const [desktopShellReady, setDesktopShellReady] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<LoginStatus | null>(null);

  useEffect(() => {
    const inDesktopShell = isDesktopShell();
    setDesktopShellReady(inDesktopShell);
    if (!inDesktopShell) router.replace("/home/");
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
      setLoginError(cause instanceof Error ? cause.message : copy.login.stateError);
    });
    return unsubscribe;
  }, [copy.login.stateError]);

  async function startLogin() {
    const api = desktopApi();
    if (!api || loginBusy) {
      setLoginError(copy.login.desktopOnly);
      return;
    }
    setLoginBusy(true);
    setLoginError(null);
    try {
      const response = await api.startBrowserLogin();
      if (!response.ok) {
        setLoginError(response.message ?? copy.login.openError);
        setLoginStatus("failed");
      }
    } catch (cause) {
      setLoginError(cause instanceof Error ? cause.message : copy.login.openError);
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
      setLoginError(cause instanceof Error ? cause.message : copy.login.cancelError);
    }
  }

  if (!desktopShellReady) return null;
  if (loading) return <DesktopLoading />;
  // An unknown sign-in state is not a signed-out user. Rendering the login screen here
  // (the old behaviour, because a thrown session lookup only cleared `user`) tells the
  // user to sign in for what is really an offline / 5xx / timeout fault — and the login
  // screen owns no socket, so the connectivity banner could never speak up on it.
  // Only replace the page when we have no user: a signed-in user keeps working, and the
  // banner carries the uncertainty.
  if (!user && sessionError) {
    return <main className="desktop-app-login">
      <section>
        <div className="desktop-app-login__mark"><WifiOff aria-hidden="true" /></div>
        <p className="desktop-command-center__eyebrow">HELSTERA DESKTOP</p>
        <h1>{copy.sessionFailed.title}</h1>
        <p>{copy.sessionFailed.description}</p>
        <Button size="lg" onClick={() => void retrySession()}>{copy.sessionFailed.retry}<ArrowRight aria-hidden="true" /></Button>
        <p className="desktop-app-login__status" role="status">{sessionError.message}</p>
      </section>
    </main>;
  }
  if (!user) {
    const loginCopy = locale === "en-US" ? {
      title: "Helstera AI workspace", description: "Confirm sign-in in your system browser and you will return here automatically. Cookies are not sent to the desktop app.",
      starting: "Opening browser…", waiting: "Waiting for confirmation…", retry: "Start sign-in again", signIn: "Sign in to your workspace",
      cancel: "Cancel sign-in", waitingState: "System browser opened. Complete sign-in there.", exchanging: "Securely exchanging sign-in ticket…",
      completed: "Signed in. Returning to your workspace…", retryState: "Sign-in ended. You can try again.",
    } : {
      title: "Helstera AI 创作工作台", description: "在系统浏览器确认登录后会自动返回此处。Cookie 不会传给桌面应用。",
      starting: "正在打开浏览器…", waiting: "等待浏览器确认…", retry: "重新发起登录", signIn: "登录并进入工作台",
      cancel: "取消登录", waitingState: "已打开系统浏览器，请完成登录。", exchanging: "正在安全兑换登录凭证…",
      completed: "登录成功，正在返回工作台…", retryState: "登录流程已结束，可以重试。",
    };
    const waiting = loginStatus === "waiting" || loginStatus === "exchanging";
    const loginStatusText = loginStatus === "waiting" ? loginCopy.waitingState
      : loginStatus === "exchanging" ? loginCopy.exchanging
        : loginStatus === "completed" ? loginCopy.completed : loginCopy.retryState;
    return <main className="desktop-app-login"><section><div className="desktop-app-login__mark"><Sparkles aria-hidden="true" /></div><p className="desktop-command-center__eyebrow">HELSTERA DESKTOP</p><h1>{loginCopy.title}</h1><p>{loginCopy.description}</p><Button size="lg" disabled={loginBusy || waiting} onClick={startLogin}>{loginBusy ? loginCopy.starting : waiting ? loginCopy.waiting : loginStatus === "failed" || loginStatus === "expired" || loginStatus === "canceled" ? loginCopy.retry : loginCopy.signIn}<ArrowUpRight aria-hidden="true" /></Button>{waiting ? <Button variant="outline" className="mt-3 w-full" onClick={cancelLogin}>{loginCopy.cancel}</Button> : null}{loginStatus ? <p className="desktop-app-login__status" role="status">{loginStatusText}</p> : null}{loginError ? <p role="alert" className="desktop-home__error">{loginError}</p> : null}</section></main>;
  }

  if (mode === "canvas") return <DesktopModule active="canvas"><Suspense fallback={<DesktopLoading />}><CanvasPage /></Suspense></DesktopModule>;
  if (mode === "projects") return <DesktopModule active="projects"><Suspense fallback={<DesktopLoading />}><ProjectsPage /></Suspense></DesktopModule>;
  if (mode === "assets") return <DesktopModule active="assets"><Suspense fallback={<DesktopLoading />}><AssetsPage /></Suspense></DesktopModule>;
  if (mode === "marketplace") return <DesktopModule active="marketplace"><Suspense fallback={<DesktopLoading />}><AgentMarketplacePage /></Suspense></DesktopModule>;
  // Settings ran ~7.5k px tall with no scroll container of its own: at 720x480 the whole
  // lower page was unreachable. Every mode must live inside the shell main.
  if (mode === "settings") return <DesktopModule active="settings"><DesktopSettingsPage /></DesktopModule>;
  if (mode === "mcp") return <DesktopAdvancedPage initialView="mcp" locale={locale} />;
  if (mode === "development") return <DesktopAdvancedPage initialView="development" locale={locale} />;
  // The home branch used to render bare, so it never received <main class="desktop-feature">.
  // That main is the only element with `overflow-y: auto`, so at a 720x480 window the lower
  // 437px of the agent form were clipped and window.scrollTo() could not reach them — the
  // real-renderer E2E caught it; jsdom cannot.
  return <DesktopModule active="home"><DesktopAgentHome email={user.email} accessToken={session?.access_token ?? ""} locale={locale} /></DesktopModule>;
}

function DesktopAgentHome({ email, accessToken, locale }: { email: string; accessToken: string; locale: Locale }) {
  const router = useRouter();
  const copy = DESKTOP_COPY[locale];
  const english = locale === "en-US";
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
        if (!connection.ok) throw new Error(connection.message ?? copy.desktopMissing);
      })
      .catch((cause) => {
        desktopRuntimeStarted.current = false;
        setDesktopRuntimeError(cause instanceof Error ? cause.message : copy.connectionFailed);
      });
  }, [accessToken, copy.connectionFailed, copy.desktopMissing]);

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
      setBrowserError(cause instanceof Error ? cause.message : copy.connectionFailed);
    } finally {
      setBrowserStatusLoading(false);
    }
  }, [accessToken, copy.connectionFailed]);

  useEffect(() => {
    if (browserMode !== "connected_browser_tab" && browserMode !== "windows_ui" && browserMode !== "visual_ocr") return;
    void refreshBrowserConnection();
    const timer = window.setInterval(() => void refreshBrowserConnection(), 3_000);
    return () => window.clearInterval(timer);
  }, [browserMode, refreshBrowserConnection]);

  useEffect(() => {
    if (!pairing || browserConnection?.status === "connected") return;
    const timer = window.setTimeout(() => {
      setBrowserError((current) => current ?? copy.assistantMissing);
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, [pairing, browserConnection?.status, copy.assistantMissing]);

  async function connectBrowserAssistant() {
    if (pairingBusy) return;
    const api = desktopApi();
    if (!api) {
      setBrowserError(copy.desktopRequired);
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
      setBrowserError(cause instanceof Error ? cause.message : copy.pairingFailed);
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
      setBrowserError(cause instanceof Error ? cause.message : copy.connectionFailed);
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
      setBrowserError(cause instanceof Error ? cause.message : copy.connectionFailed);
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
      const requiresDesktopConnection = browserMode === "windows_ui" || browserMode === "visual_ocr";
      if (browserMode === "connected_browser_tab" || requiresDesktopConnection) {
        const connection = await fetchWebsiteAssistantConnection(accessToken);
        setBrowserConnection(connection);
        const expectedClient = requiresDesktopConnection ? "desktop-app" : "browser-extension";
        if (connection?.status !== "connected" || connection.clientKind !== expectedClient) {
          if (requiresDesktopConnection) throw new Error(copy.desktopRequired);
          throw new Error(copy.browserRequired);
        }
      }
      const project = await createProject(accessToken, {
        name: goal.length > 48 ? `${goal.slice(0, 45)}…` : goal,
        // Home entry point: the goal text *is* the project name and the user
        // never saw a "new project" form, so tag it as auto-created.
        source: "home",
      }, { idempotencyKey: crypto.randomUUID() });
      const query = new URLSearchParams({
        id: project.project.primaryCanvas.id,
        prompt: goal,
        browserMode,
      });
      router.replace(`/desktop-app/canvas/?${query.toString()}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.startFailed);
    } finally {
      setBusy(false);
    }
  }

  async function copyPairingUrl() {
    if (!pairingUrl) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
      setBrowserError(copy.pairingCopied);
    } catch (cause) {
      setBrowserError(cause instanceof Error ? cause.message : copy.pairingFailed);
    }
  }

  function chooseTemplate(template: typeof taskTemplates[number]) {
    setPrompt(english ? template.promptEn : template.prompt);
    setBrowserMode(template.mode);
    document.getElementById("desktop-agent-prompt")?.focus();
  }

  return <main className="desktop-agent-home">
    <header className="desktop-agent-home__header">
      <div><p className="desktop-command-center__eyebrow">HELSTERA DESKTOP / AGENT</p><h1>{copy.heading}</h1><p>{copy.intro}</p></div>
      <div className="desktop-command-center__identity"><span className="desktop-command-center__status" />{email}<span>{copy.connected}</span></div>
    </header>
    <section className="desktop-agent-composer" aria-label={copy.goal}>
      <form onSubmit={startAgent}>
        <label htmlFor="desktop-agent-prompt">{copy.goal}</label>
        <textarea id="desktop-agent-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={copy.placeholder} rows={4} maxLength={4000} disabled={busy} />
        <div className="desktop-agent-composer__footer">
          <fieldset><legend>{copy.modeLegend}</legend>
            <button type="button" role="radio" aria-checked={browserMode === "isolated_browser"} className={browserMode === "isolated_browser" ? "is-selected" : ""} onClick={() => setBrowserMode("isolated_browser")}>{copy.modes.isolated_browser}</button>
            <button type="button" role="radio" aria-checked={browserMode === "connected_browser_tab"} className={browserMode === "connected_browser_tab" ? "is-selected" : ""} onClick={() => setBrowserMode("connected_browser_tab")}>{copy.modes.connected_browser_tab}</button>
            <button type="button" role="radio" aria-checked={browserMode === "windows_ui"} className={browserMode === "windows_ui" ? "is-selected" : ""} onClick={() => setBrowserMode("windows_ui")}>{copy.modes.windows_ui}</button>
            <button type="button" role="radio" aria-checked={browserMode === "visual_ocr"} className={browserMode === "visual_ocr" ? "is-selected" : ""} onClick={() => setBrowserMode("visual_ocr")}>{copy.modes.visual_ocr}</button>
          </fieldset>
          <Button type="submit" disabled={busy || !prompt.trim() || !accessToken}>{busy ? <><LoaderCircle className="animate-spin" aria-hidden="true" />{copy.preparing}</> : <>{copy.start}<ArrowRight aria-hidden="true" /></>}</Button>
        </div>
      </form>
      {error ? <p className="desktop-agent-home__error" role="alert">{error}</p> : null}
      {desktopRuntimeError ? <p className="desktop-agent-home__error" role="alert">{desktopRuntimeError}</p> : null}
    </section>
    <p className="desktop-agent-mode-hint" role="status">{copy.hints[browserMode]}</p>
    {browserMode === "connected_browser_tab" || browserMode === "windows_ui" || browserMode === "visual_ocr" ? <section className="desktop-browser-connection" aria-label={copy.connection}>
      <div className="desktop-browser-connection__status" role="status" aria-live="polite">
        <span className={browserConnection?.status === "connected" && ((browserMode === "connected_browser_tab" && browserConnection.clientKind === "browser-extension") || (browserMode !== "connected_browser_tab" && browserConnection.clientKind === "desktop-app")) ? "is-connected" : "is-disconnected"} aria-hidden="true" />
        <div>
          <strong>{browserStatusLoading && !browserConnection ? copy.checking : browserConnection?.status === "connected" ? browserConnection.clientKind === "desktop-app" ? copy.desktopConnected : (browserConnection.browser === "edge" ? "Microsoft Edge" : "Chrome") + " " + copy.extensionConnected : browserConnection?.status === "paused" ? copy.paused : browserMode === "connected_browser_tab" ? copy.browserMissing : copy.desktopMissing}</strong>
          <small>{browserConnection?.status === "connected" ? browserMode === "connected_browser_tab" ? copy.browserInfo : copy.desktopInfo : copy.notConnected}</small>
        </div>
      </div>
      {browserConnection?.status === "connected" && !((browserMode === "connected_browser_tab" && browserConnection.clientKind === "browser-extension") || (browserMode !== "connected_browser_tab" && browserConnection.clientKind === "desktop-app")) ? <p className="desktop-browser-connection__error" role="status">{copy.mismatch}</p> : null}
      <div className="desktop-browser-connection__actions">
        {browserMode === "connected_browser_tab" ? browserConnection?.status === "connected"
          ? <button type="button" onClick={() => void disconnectBrowserAssistant()} disabled={pairingBusy}><WifiOff aria-hidden="true" />{copy.disconnect}</button>
          : browserConnection?.status === "paused"
            ? <button type="button" onClick={() => void resumeBrowserAssistant()} disabled={pairingBusy}><PlugZap aria-hidden="true" />{copy.resume}</button>
            : <Button type="button" variant="outline" onClick={() => void connectBrowserAssistant()} disabled={pairingBusy}>{pairingBusy ? <><LoaderCircle className="animate-spin" aria-hidden="true" />{copy.connecting}</> : <><PlugZap aria-hidden="true" />{copy.connect}</>}</Button>
          : null}
        {pairingBusy || browserStatusLoading ? <LoaderCircle className="desktop-browser-connection__spinner animate-spin" aria-label={copy.checking} /> : null}
      </div>
      {browserMode === "connected_browser_tab" && pairing && browserConnection?.status !== "connected" ? <div className="desktop-browser-connection__hint"><span>{copy.pairingTitle}. {copy.pairingExpires} {new Date(pairing.expiresAt).toLocaleTimeString()}. {copy.pairingRestore}</span>{pairingUrl ? <button type="button" onClick={() => void copyPairingUrl()}><Copy aria-hidden="true" />{copy.copyPairing}</button> : null}</div> : null}
      {browserError ? <p className="desktop-browser-connection__error" role="alert">{browserError}</p> : null}
    </section> : null}
    <section className="desktop-agent-templates" aria-label={copy.templateTitle}>
      <div className="desktop-agent-templates__heading"><div><p>{copy.templateEyebrow}</p><h2>{copy.templateTitle}</h2></div></div>
      <div className="desktop-agent-templates__list">{taskTemplates.map((template) => { const Icon = template.icon; return <button key={template.id} type="button" onClick={() => chooseTemplate(template)}><Icon aria-hidden="true" /><span>{english ? template.labelEn : template.label}</span><ArrowUpRight aria-hidden="true" /></button>; })}</div>
    </section>
    <footer className="desktop-agent-home__footer"><span><Images aria-hidden="true" />{copy.assetFooter}</span><button type="button" onClick={() => router.replace("/desktop-app/development/")}><Blocks aria-hidden="true" />{copy.advanced}</button></footer>
  </main>
}

function DesktopAdvancedPage({ initialView, locale }: { initialView: "mcp" | "development"; locale: Locale }) {
  const view = initialView;
  const title = view === "mcp"
    ? locale === "en-US" ? "MCP tools" : "MCP 工具"
    : locale === "en-US" ? "Local development" : "本地开发";
  return <main className="desktop-feature"><section className={`desktop-feature__content desktop-feature__content--${view}`}><h1 className="desktop-feature__page-title">{title}</h1>{view === "mcp" ? <DesktopMcpPanel /> : <DesktopWorkbench />}</section></main>;
}

function DesktopModule({ active, children }: { active: string; children: ReactNode }) {
  return (
    active === "canvas"
      ? <main className="desktop-canvas-workspace">{children}</main>
      : <main className="desktop-feature"><section className={`desktop-feature__content desktop-feature__content--${active}`}>{children}</section></main>
  );
}

function DesktopLoading() { return <div className="desktop-module-loading" aria-busy="true"><span /></div>; }
