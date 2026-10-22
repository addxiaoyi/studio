"use client";

import { useEffect, useState } from "react";
import type { DesktopAgentRole, DesktopCapability, WebsiteCaptureAssistantConnection, WebsiteCapturePairing } from "@helstera/shared";
import { cancelDesktopAgentTask, createDesktopAgentTask, createWebsiteCapturePairing, fetchDesktopAgentTasks, fetchWebsiteAssistantConnection, resolveDesktopAgentApproval, revokeWebsiteAssistant, setWebsiteAssistantPaused, type DesktopAgentTaskResponse } from "@/lib/server-api";

export function WebsiteAssistantSettings({ accessToken }: { accessToken: string }) {
  const [connection, setConnection] = useState<WebsiteCaptureAssistantConnection | null>(null);
  const [pairing, setPairing] = useState<WebsiteCapturePairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [embeddedUrl, setEmbeddedUrl] = useState("http://localhost:3000");
  const [desktopTasks, setDesktopTasks] = useState<DesktopAgentTaskResponse[]>([]);
  const [desktopGoal, setDesktopGoal] = useState("");
  const [desktopRole, setDesktopRole] = useState<DesktopAgentRole>("researcher");
  const [desktopCapabilities, setDesktopCapabilities] = useState<DesktopCapability[]>(["browser.read", "browser.capture"]);
  const [taskBusy, setTaskBusy] = useState(false);
  const [cancelingTaskId, setCancelingTaskId] = useState<string | null>(null);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  const electronApi = typeof window !== "undefined"
    ? (window as Window & { electronAPI?: { openEmbeddedBrowser: (url: string) => Promise<{ ok: boolean }>; connectEmbeddedAssistant: (input: { wssUrl: string; code: string }) => Promise<{ ok: boolean }> } }).electronAPI
    : undefined;

  const refresh = async () => {
    try {
      const [nextConnection, nextTasks] = await Promise.all([fetchWebsiteAssistantConnection(accessToken), fetchDesktopAgentTasks(accessToken)]);
      setConnection(nextConnection);
      setDesktopTasks(nextTasks);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取助手状态"); }
  };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(timer); }, [accessToken]);

  const createPairing = async () => {
    setBusy(true); setError(null);
    try { setPairing(await createWebsiteCapturePairing(accessToken)); } catch (cause) { setError(cause instanceof Error ? cause.message : "配对码创建失败"); } finally { setBusy(false); }
  };
  const togglePause = async () => {
    setBusy(true); setError(null);
    try { setConnection(await setWebsiteAssistantPaused(accessToken, !connection?.paused)); } catch (cause) { setError(cause instanceof Error ? cause.message : "助手状态更新失败"); } finally { setBusy(false); }
  };
  const revoke = async () => {
    setBusy(true); setError(null);
    try { await revokeWebsiteAssistant(accessToken); setConnection(null); setPairing(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "撤销失败"); } finally { setBusy(false); }
  };

  const toggleCapability = (capability: DesktopCapability) => {
    setDesktopCapabilities((current) => current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability]);
  };

  const submitDesktopTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!desktopGoal.trim() || desktopCapabilities.length === 0 || taskBusy) return;
    setTaskBusy(true); setError(null);
    try {
      await createDesktopAgentTask(accessToken, { goal: desktopGoal.trim(), role: desktopRole, capabilities: desktopCapabilities, ...(embeddedUrl.trim() ? { targetUrl: embeddedUrl.trim() } : {}), maxDurationSeconds: 300, pageLimit: 3 });
      setDesktopGoal("");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "桌面协作任务提交失败"); } finally { setTaskBusy(false); }
  };

  const taskStatusText = (status: DesktopAgentTaskResponse["status"]) => ({ queued: "排队中", running: "执行中", succeeded: "已完成", failed: "失败", canceled: "已取消" })[status];

  const cancelTask = async (taskId: string) => {
    setCancelingTaskId(taskId); setError(null);
    try {
      await cancelDesktopAgentTask(accessToken, taskId);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "取消桌面任务失败"); } finally { setCancelingTaskId(null); }
  };

  const resolveApproval = async (approvalId: string, decision: "approve" | "reject") => {
    setResolvingApprovalId(approvalId); setError(null);
    try {
      await resolveDesktopAgentApproval(accessToken, approvalId, decision);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "处理动作审批失败"); } finally { setResolvingApprovalId(null); }
  };

  return (
    <section className="mt-8 rounded-xl border border-border/60 bg-card p-5" aria-labelledby="website-assistant-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="website-assistant-title" className="text-sm font-semibold">本地浏览器助手</h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">连接 Chrome 或 Edge 的当前标签页，让网站浏览任务读取登录态页面。Cookie、密码、OTP 和浏览器本地存储不会发送给 Helstera。</p>
        </div>
        <span role="status" className={`rounded-full border px-2.5 py-1 text-[11px] ${connection?.status === "connected" ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "border-border/60 text-muted-foreground"}`}>{connection?.status === "connected" ? "已连接" : connection?.status === "paused" ? "已暂停" : "未连接"}</span>
      </div>
      {connection ? <p className="mt-3 text-xs text-muted-foreground">{connection.browser} · {connection.platform} · 最近活动 {new Date(connection.lastSeenAt).toLocaleString()}</p> : null}
      {pairing ? <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3"><p className="text-xs font-medium">一次性配对码（10 分钟内有效）</p><code className="mt-2 block break-all text-lg font-semibold tracking-[0.18em]">{pairing.code}</code><p className="mt-2 break-all text-[11px] text-muted-foreground">WSS：{pairing.wssUrl}</p><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{pairing.disclosure}</p></div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void createPairing()} disabled={busy} className="min-h-10 rounded-md bg-foreground px-3 text-xs font-medium text-background disabled:opacity-50">生成配对码</button>
        {connection ? <button type="button" onClick={() => void togglePause()} disabled={busy} className="min-h-10 rounded-md border border-border/70 px-3 text-xs">{connection.paused ? "恢复连接" : "暂停浏览"}</button> : null}
        {connection ? <button type="button" onClick={() => void revoke()} disabled={busy} className="min-h-10 rounded-md border border-destructive/30 px-3 text-xs text-destructive">撤销并断开</button> : null}
      </div>
      {electronApi ? <div className="mt-4 rounded-lg border border-border/50 bg-muted/20 p-3"><p className="text-xs font-medium">桌面内嵌浏览器</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">使用独立浏览器分区打开本地站点；登录态留在桌面端，不会发送给服务器。</p><div className="mt-2 flex gap-2"><input aria-label="桌面内嵌浏览器 URL" value={embeddedUrl} onChange={(event) => setEmbeddedUrl(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 text-sm" /><button type="button" onClick={() => void electronApi.openEmbeddedBrowser(embeddedUrl).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "无法打开内嵌浏览器"))} className="min-h-9 rounded-md border border-border/70 px-2.5 text-xs">打开</button>{pairing?.code ? <button type="button" onClick={() => void electronApi.connectEmbeddedAssistant({ wssUrl: pairing.wssUrl, code: pairing.code! }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "桌面助手连接失败"))} className="min-h-9 rounded-md border border-primary/40 px-2.5 text-xs">连接桌面助手</button> : null}</div></div> : null}
      <section className="mt-4 rounded-lg border border-border/50 bg-muted/20 p-3" aria-labelledby="desktop-agent-title">
        <div className="flex items-start justify-between gap-3">
          <div><h3 id="desktop-agent-title" className="text-xs font-semibold">桌面 Agent 协作</h3><p className="mt-1 text-[11px] leading-5 text-muted-foreground">仅开放你声明的浏览器能力；点击和输入等副作用仍需单独批准。</p></div>
          <span className="text-[11px] text-muted-foreground">{desktopTasks.length} 个任务</span>
        </div>
        <form className="mt-3 space-y-2" onSubmit={(event) => void submitDesktopTask(event)}>
          <label className="block text-[11px] font-medium" htmlFor="desktop-agent-goal">任务目标</label>
          <textarea id="desktop-agent-goal" value={desktopGoal} onChange={(event) => setDesktopGoal(event.target.value)} placeholder="例如：读取当前页面标题、导航和主要功能" className="min-h-16 w-full resize-y rounded-md border border-border/60 bg-background px-2 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-1.5 text-[11px]"><span>角色</span><select value={desktopRole} onChange={(event) => setDesktopRole(event.target.value as DesktopAgentRole)} className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs"><option value="researcher">研究员</option><option value="planner">规划员</option><option value="operator">操作员</option><option value="reviewer">审阅员</option></select></label>
            {(["browser.read", "browser.navigate", "browser.scroll", "browser.capture"] as const).map((capability) => <label key={capability} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border/60 px-2 text-[11px]"><input type="checkbox" checked={desktopCapabilities.includes(capability)} onChange={() => toggleCapability(capability)} />{capability}</label>)}
          </div>
          <button type="submit" disabled={taskBusy || !desktopGoal.trim() || desktopCapabilities.length === 0 || connection?.status !== "connected"} className="min-h-9 rounded-md bg-foreground px-3 text-xs font-medium text-background disabled:opacity-50">{taskBusy ? "正在提交…" : "开始桌面任务"}</button>
        </form>
        {desktopTasks.length > 0 ? <div className="mt-3 space-y-2" aria-label="桌面 Agent 任务列表">{desktopTasks.slice(0, 5).map((task) => {
          const page = task.result?.page as { url?: string; title?: string; description?: string; headings?: string[]; navigation?: string[] } | undefined;
          const finalScreenshot = task.result?.screenshotAsset as { assetId?: string; url?: string } | undefined;
          return <article key={task.taskId} className="rounded-md border border-border/50 bg-background/60 p-2.5"><div className="flex items-start justify-between gap-2"><p className="min-w-0 text-xs font-medium">{task.goal}</p><span className="shrink-0 text-[11px] text-muted-foreground">{taskStatusText(task.status)}</span></div><p className="mt-1 text-[11px] text-muted-foreground">{task.role} · {task.capabilities.join("、")}</p>
            {task.status === "running" || task.status === "queued" ? <button type="button" onClick={() => void cancelTask(task.taskId)} disabled={cancelingTaskId !== null} className="mt-2 min-h-8 rounded-md border border-destructive/40 px-2.5 text-[11px] text-destructive disabled:opacity-50">{cancelingTaskId === task.taskId ? "正在取消…" : "取消任务"}</button> : null}
            {task.events.length > 0 ? <ol className="mt-2 space-y-2 border-l border-border/70 pl-2.5" aria-label="任务进度">{task.events.slice(0, 4).map((event, index) => {
              const eventResult = event.result;
              const eventPage = eventResult?.page as { title?: string; url?: string } | undefined;
              const eventScreenshot = eventResult?.screenshotAsset as { url?: string } | undefined;
              return <li key={`${event.createdAt}-${index}`} className="text-[11px] leading-4 text-muted-foreground"><span className="font-medium text-foreground">{eventTypeLabel(event.eventType)}</span>{event.detail ? ` · ${event.detail}` : ""}{eventPage?.title ? <p className="mt-0.5 text-foreground">{eventPage.title}{eventPage.url ? ` · ${eventPage.url}` : ""}</p> : null}{eventScreenshot?.url ? <a href={eventScreenshot.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-2 underline underline-offset-2"><img src={eventScreenshot.url} alt={`桌面截图${eventPage?.title ? `：${eventPage.title}` : ""}`} className="h-16 w-28 rounded border border-border/60 object-cover" />查看截图</a> : null}</li>;
            })}</ol> : null}
            {task.pendingApprovals.map((approval) => <div key={approval.approvalId} className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5"><p className="text-[11px] font-semibold text-foreground">动作审批待处理</p><p className="mt-1 break-words text-[11px] text-foreground">{desktopActionLabel(approval.action)}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">仅批准你看到的这一项操作。审批十分钟后失效。</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => void resolveApproval(approval.approvalId, "approve")} disabled={resolvingApprovalId !== null} className="min-h-8 rounded-md bg-foreground px-2.5 text-[11px] text-background disabled:opacity-50">{resolvingApprovalId === approval.approvalId ? "处理中…" : "批准此动作"}</button><button type="button" onClick={() => void resolveApproval(approval.approvalId, "reject")} disabled={resolvingApprovalId !== null} className="min-h-8 rounded-md border border-border/70 px-2.5 text-[11px] text-foreground disabled:opacity-50">拒绝</button></div></div>)}
            {page ? <div className="mt-2 border-t border-border/50 pt-2"><p className="text-xs font-medium">{page.title || "已读取页面"}</p>{page.url ? <a href={page.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[11px] text-muted-foreground underline underline-offset-2">{page.url}</a> : null}{page.description ? <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{page.description}</p> : null}{page.headings?.length ? <p className="mt-1 text-[11px] leading-4 text-muted-foreground">标题：{page.headings.slice(0, 5).join(" · ")}</p> : null}{finalScreenshot?.url ? <a href={finalScreenshot.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-[11px] underline underline-offset-2"><img src={finalScreenshot.url} alt={`桌面截图：${page.title || "页面"}`} className="h-16 w-28 rounded border border-border/60 object-cover" />查看素材库截图</a> : null}</div> : null}
            {task.error ? <p role="alert" className="mt-1 text-[11px] text-destructive">{task.error}</p> : null}</article>;
        })}</div> : <p className="mt-3 text-[11px] text-muted-foreground">尚无桌面协作任务</p>}
      </section>
      {error ? <p role="alert" className="mt-3 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

function eventTypeLabel(eventType: string) {
  const labels: Record<string, string> = { started: "已启动", progress: "处理中", page: "页面证据", approval_required: "等待审批", completed: "已完成", failed: "失败", canceled: "已取消" };
  return labels[eventType] ?? eventType;
}

function desktopActionLabel(action: DesktopAgentTaskResponse["pendingApprovals"][number]["action"]) {
  const target = action.target || action.targetUrl || "目标页面";
  switch (action.kind) {
    case "click": return `点击 ${target}`;
    case "type": return `在 ${target} 输入：${action.value ?? "(空内容)"}`;
    default: return `${action.kind} · ${target}`;
  }
}
