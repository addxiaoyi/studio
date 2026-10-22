"use client";

import {
  ArrowUpRight,
  Clapperboard,
  FilePlus2,
  Film,
  FolderKanban,
  Images,
  Palette,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { fetchDesktopAgentTasks, type DesktopAgentTaskResponse } from "@/lib/server-api";
import { Button } from "@/components/ui/button";

type DesktopLoginApi = {
  startBrowserLogin: () => Promise<{ ok: boolean; message?: string }>;
};

const workspaces = [
  { href: "/create/", label: "新建创作", detail: "从一句需求开始生成内容", icon: FilePlus2, tone: "bg-foreground text-background" },
  { href: "/feed/", label: "内容增长 Feed", detail: "选题、脚本、发布与复盘", icon: Film, tone: "bg-emerald-600 text-white" },
  { href: "/projects/", label: "项目空间", detail: "管理长期项目和交付物", icon: FolderKanban, tone: "bg-sky-600 text-white" },
  { href: "/assets/", label: "素材库", detail: "图片、视频和生成资产", icon: Images, tone: "bg-amber-500 text-white" },
  { href: "/brand-kit/", label: "品牌资产", detail: "品牌规范和商品资料", icon: Palette, tone: "bg-violet-600 text-white" },
  { href: "/storyboard/", label: "分镜工作台", detail: "把想法整理成可执行镜头", icon: Clapperboard, tone: "bg-rose-600 text-white" },
];

function loginApi() {
  return (window as Window & { electronAPI?: DesktopLoginApi }).electronAPI;
}

export default function DesktopPage() {
  const { user, loading } = useAuth();
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<DesktopAgentTaskResponse[]>([]);

  useEffect(() => {
    if (!user) return;
    void fetchDesktopAgentTasks("local-session").then(setTasks).catch(() => setTasks([]));
  }, [user]);

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
      if (!response.ok) setLoginError(response.message ?? "暂时无法打开浏览器登录。");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "暂时无法打开浏览器登录。");
    } finally {
      setLoginBusy(false);
    }
  }

  if (loading) return <main className="desktop-home desktop-home--loading" aria-busy="true"><div className="desktop-home__skeleton" /></main>;

  if (!user) {
    return (
      <main className="desktop-home desktop-home--login">
        <section className="desktop-login-panel" aria-labelledby="desktop-login-title">
          <div className="desktop-login-panel__mark"><Sparkles aria-hidden="true" /></div>
          <p className="desktop-eyebrow">HELSTERA DESKTOP</p>
          <h1 id="desktop-login-title">你的 AI 创作工作台</h1>
          <p>使用系统浏览器完成登录确认，桌面端会自动回到你的工作区。桌面端不会读取浏览器 Cookie。</p>
          <Button type="button" size="lg" disabled={loginBusy} onClick={() => void startLogin()}>
            {loginBusy ? "正在打开浏览器…" : "登录并进入工作台"}
            <ArrowUpRight aria-hidden="true" />
          </Button>
          {loginError ? <p className="desktop-home__error" role="alert">{loginError}</p> : null}
          <p className="desktop-login-panel__note">登录、确认和授权均在浏览器中完成</p>
        </section>
      </main>
    );
  }

  return (
    <main className="desktop-home">
      <header className="desktop-home__header">
        <div>
          <p className="desktop-eyebrow">HELSTERA DESKTOP / WORKSPACE</p>
          <h1>欢迎回来，开始今天的创作</h1>
          <p>从创作、素材到内容发布，所有工作都在一个桌面工作区完成。</p>
        </div>
        <Link href="/settings/" className="desktop-home__account">{user.email}<span>设置</span></Link>
      </header>

      <section className="desktop-home__section" aria-labelledby="desktop-actions-title">
        <div className="desktop-home__section-heading"><h2 id="desktop-actions-title">开始工作</h2><span>常用工作区</span></div>
        <div className="desktop-workspace-grid">
          {workspaces.map((workspace) => {
            const Icon = workspace.icon;
            return <Link key={workspace.href} href={workspace.href} className="desktop-workspace-card"><span className={`desktop-workspace-card__icon ${workspace.tone}`}><Icon aria-hidden="true" /></span><span><strong>{workspace.label}</strong><small>{workspace.detail}</small></span><ArrowUpRight className="desktop-workspace-card__arrow" aria-hidden="true" /></Link>;
          })}
        </div>
      </section>

      <section className="desktop-home__section" aria-labelledby="desktop-recent-title">
        <div className="desktop-home__section-heading"><h2 id="desktop-recent-title">最近任务</h2><Link href="/home/">查看工作台 <ArrowUpRight aria-hidden="true" /></Link></div>
        {tasks.length ? <div className="desktop-task-list">{tasks.slice(0, 4).map((task) => <Link key={task.taskId} href="/settings/" className="desktop-task-row"><span className={`desktop-task-dot desktop-task-dot--${task.status}`} /><span className="desktop-task-row__body"><strong>{task.goal}</strong><small>{task.role} · {task.status}</small></span><ArrowUpRight aria-hidden="true" /></Link>)}</div> : <div className="desktop-empty"><Sparkles aria-hidden="true" /><span>还没有桌面 Agent 任务，从上方工作区开始吧。</span></div>}
      </section>
    </main>
  );
}
