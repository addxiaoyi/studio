"use client";

import { ArrowRight, ArrowUpRight, Blocks, Clock3, FilePlus2, FolderOpen, Images, PanelsTopLeft, Sparkles, TerminalSquare } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { DesktopWorkbench } from "@/components/desktop-workbench";
import { DesktopMcpPanel } from "@/components/desktop-mcp-panel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import ProjectsPage from "@/app/(workspace)/projects/page";
import AssetsPage from "@/app/(workspace)/assets/page";

type DesktopLoginApi = {
  startBrowserLogin: () => Promise<{ ok: boolean; message?: string }>;
  cancelBrowserLogin: () => Promise<{ ok: boolean }>;
  onBrowserLoginState: (
    callback: (state: { status: DesktopLoginStatus }) => void,
  ) => () => void;
};
type DesktopLoginStatus =
  | "waiting"
  | "exchanging"
  | "completed"
  | "failed"
  | "canceled"
  | "expired";

function loginApi() {
  return (window as Window & { electronAPI?: DesktopLoginApi }).electronAPI;
}

export default function DesktopPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectToCanvas = useCallback(
    () => router.replace("/canvas/"),
    [router],
  );
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<DesktopLoginStatus | null>(null);
  const isDesktop = Boolean(loginApi());

  useEffect(() => {
    const api = loginApi();
    if (!api) return;
    return api.onBrowserLoginState(({ status }) => setLoginStatus(status));
  }, []);

  useEffect(() => {
    if (!isDesktop) router.replace("/home/");
  }, [isDesktop, router]);

  async function startLogin() {
    const api = loginApi();
    if (!api || loginBusy) {
      setLoginError("请使用正式 Helstera Desktop 启动浏览器登录。");
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
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "暂时无法打开浏览器登录。",
      );
      setLoginStatus("failed");
    } finally {
      setLoginBusy(false);
    }
  }

  async function cancelLogin() {
    const api = loginApi();
    if (!api) return;
    setLoginError(null);
    try {
      await api.cancelBrowserLogin();
      setLoginStatus("canceled");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "取消登录失败，请重试。");
    }
  }

  const isWaitingForBrowser = loginStatus === "waiting" || loginStatus === "exchanging";
  const loginStatusText = {
    waiting: "已打开系统浏览器，请完成登录并确认。",
    exchanging: "正在安全地完成桌面登录…",
    completed: "登录成功，正在打开工作区。",
    failed: "登录未完成，请重新发起。",
    canceled: "登录已取消。",
    expired: "登录请求已过期，请重新发起。",
  }[loginStatus ?? "waiting"];

  if (!isDesktop) return null;

  if (loading)
    return (
      <main className="desktop-home desktop-home--loading" aria-busy="true">
        <div className="desktop-home__skeleton" />
      </main>
    );

  if (!user) {
    return (
      <main className="desktop-home desktop-home--login">
        <section
          className="desktop-login-panel"
          aria-labelledby="desktop-login-title"
        >
          <div className="desktop-login-panel__mark">
            <Sparkles aria-hidden="true" />
          </div>
          <p className="desktop-eyebrow">HELSTERA DESKTOP</p>
          <h1 id="desktop-login-title">你的 AI 创作工作台</h1>
          <p>
            使用系统浏览器完成登录确认，桌面端会自动回到你的工作区。桌面端不会读取浏览器
            Cookie。
          </p>
          <Button
            type="button"
            size="lg"
            disabled={loginBusy || isWaitingForBrowser}
            onClick={startLogin}
          >
            {loginBusy
              ? "正在打开浏览器…"
              : loginStatus === "waiting" || loginStatus === "exchanging"
                ? "等待浏览器确认…"
                : loginStatus === "expired" || loginStatus === "failed" || loginStatus === "canceled"
                  ? "重新发起登录"
                  : "登录并进入工作台"}
            <ArrowUpRight aria-hidden="true" />
          </Button>
          {isWaitingForBrowser ? (
            <Button type="button" variant="outline" className="mt-3 w-full" onClick={cancelLogin}>
              取消登录
            </Button>
          ) : null}
          {loginStatus ? <p className="mt-3 text-center text-sm text-muted-foreground" role="status">{loginStatusText}</p> : null}
          {loginError ? (
            <p className="desktop-home__error" role="alert">
              {loginError}
            </p>
          ) : null}
          <p className="desktop-login-panel__note">
            登录、确认和授权均在浏览器中完成
          </p>
        </section>
      </main>
    );
  }

  const mode = searchParams.get("mode");
  if (mode === "code") return <DesktopFeatureFrame active="code"><DesktopWorkbench /></DesktopFeatureFrame>;
  if (mode === "projects") return <DesktopFeatureFrame active="projects"><Suspense fallback={<DesktopModuleLoading />}><ProjectsPage /></Suspense></DesktopFeatureFrame>;
  if (mode === "assets") return <DesktopFeatureFrame active="assets"><Suspense fallback={<DesktopModuleLoading />}><AssetsPage /></Suspense></DesktopFeatureFrame>;
  if (mode === "mcp") return <DesktopFeatureFrame active="mcp"><DesktopMcpPanel /></DesktopFeatureFrame>;
  return <DesktopCommandCenter userEmail={user.email} onOpenCanvas={redirectToCanvas} onOpenCode={() => router.replace("/desktop/?mode=code")} />;
}

function DesktopModuleLoading() {
  return <div className="desktop-module-loading" aria-busy="true"><span /></div>;
}

function DesktopFeatureFrame({ active, children }: { active: "projects" | "assets" | "code" | "mcp"; children: ReactNode }) {
  const router = useRouter();
  const items = [
    { id: "projects", label: "项目" },
    { id: "assets", label: "素材" },
    { id: "code", label: "本地开发" },
    { id: "mcp", label: "MCP 工具" },
  ] as const;
  return (
    <main className="desktop-feature" aria-label="桌面辅助工作区">
      <header className="desktop-feature__header">
        <div><p>HELSTERA DESKTOP / WORKSPACE</p><h1>{items.find((item) => item.id === active)?.label}</h1></div>
        <button type="button" onClick={() => router.replace("/desktop/")}>返回桌面首页</button>
      </header>
      <nav className="desktop-feature__nav" aria-label="桌面辅助模块">
        {items.map((item) => <button key={item.id} type="button" aria-current={active === item.id ? "page" : undefined} onClick={() => router.replace(`/desktop/?mode=${item.id}`)}>{item.label}</button>)}
      </nav>
      <section className={`desktop-feature__content desktop-feature__content--${active}`}>{children}</section>
    </main>
  );
}

function DesktopCommandCenter({ userEmail, onOpenCanvas, onOpenCode }: { userEmail: string; onOpenCanvas: () => void; onOpenCode: () => void }) {
  return (
    <main className="desktop-command-center" aria-label="Helstera Desktop 工作台">
      <section className="desktop-command-center__hero">
        <div>
          <p className="desktop-command-center__eyebrow">HELSTERA DESKTOP / WORKSPACE</p>
          <h1>把想法直接推进到画布。</h1>
          <p className="desktop-command-center__lede">创作、素材和 Agent 工作流集中在一个客户端里。桌面端保留网站能力，但把重复操作收进更快的工作区。</p>
        </div>
        <div className="desktop-command-center__identity"><span className="desktop-command-center__status" />{userEmail}<span>已连接</span></div>
      </section>

      <section className="desktop-command-center__primary" aria-labelledby="desktop-primary-title">
        <div className="desktop-command-center__section-head"><div><p className="desktop-command-center__kicker">PRIMARY WORKSPACE</p><h2 id="desktop-primary-title">继续创作</h2></div><button type="button" onClick={onOpenCanvas}>打开画布 <ArrowRight aria-hidden="true" /></button></div>
        <button type="button" className="desktop-command-center__canvas-launch" onClick={onOpenCanvas}>
          <span className="desktop-command-center__canvas-icon"><PanelsTopLeft aria-hidden="true" /></span>
          <span><strong>画布工作区</strong><small>从空白、项目或已有素材开始，聊天 Agent 始终跟随当前画布。</small></span>
          <ArrowRight aria-hidden="true" />
        </button>
      </section>

      <section className="desktop-command-center__grid" aria-label="桌面快捷入口">
        <DesktopAction icon={FilePlus2} label="新建创作" detail="从一句需求开始" href="/create/" />
        <DesktopAction icon={FolderOpen} label="项目空间" detail="继续最近项目" href="/desktop/?mode=projects" />
        <DesktopAction icon={Images} label="素材库" detail="查找生成资产" href="/desktop/?mode=assets" />
        <button type="button" className="desktop-command-center__action" onClick={onOpenCode}><span className="desktop-command-center__action-icon"><TerminalSquare aria-hidden="true" /></span><span><strong>开发辅助</strong><small>本地项目与 Git</small></span><ArrowRight aria-hidden="true" /></button>
      </section>

      <section className="desktop-command-center__lower">
        <div><div className="desktop-command-center__section-head"><div><p className="desktop-command-center__kicker">RECENT</p><h2>最近工作</h2></div><Clock3 aria-hidden="true" /></div><div className="desktop-command-center__empty"><Sparkles aria-hidden="true" /><span>打开画布后，最近项目和生成任务会显示在这里。</span></div></div>
        <div><div className="desktop-command-center__section-head"><div><p className="desktop-command-center__kicker">CONNECTED</p><h2>辅助能力</h2></div><Blocks aria-hidden="true" /></div><div className="desktop-command-center__status-list"><span><i className="is-ready" />聊天 Agent <small>可用</small></span><span><i className="is-muted" />MCP 注册表 <small>前往开发辅助</small></span></div></div>
      </section>
    </main>
  );
}

function DesktopAction({ icon: Icon, label, detail, href }: { icon: typeof FilePlus2; label: string; detail: string; href: string }) {
  const router = useRouter();
  return <button type="button" className="desktop-command-center__action" onClick={() => router.replace(href)}><span className="desktop-command-center__action-icon"><Icon aria-hidden="true" /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight aria-hidden="true" /></button>;
}

function DesktopCanvasRedirect({ onRedirect }: { onRedirect: () => void }) {
  useEffect(() => onRedirect(), [onRedirect]);
  return (
    <main className="desktop-canvas-entry" aria-busy="true">
      <div className="desktop-canvas-entry__mark">
        <Sparkles aria-hidden="true" />
      </div>
      <p>正在打开 Helstera 画布…</p>
      <span>聊天、生成、编辑和导出都在画布中完成。</span>
    </main>
  );
}
