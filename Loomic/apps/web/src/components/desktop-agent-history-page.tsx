"use client";

import { useCallback, useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchDesktopAgentTasks, type DesktopAgentTaskResponse } from "@/lib/server-api";
import { DesktopAgentProgressCard } from "@/components/chat/desktop-agent-progress-card";

const modes: Record<string, string> = { automatic: "自动选择", isolated_browser: "隔离浏览器", connected_browser_tab: "授权浏览器标签", windows_ui: "本机控件树", visual_ocr: "视觉 / OCR" };

export function DesktopAgentHistoryPage() {
  const { session } = useAuth();
  const [tasks, setTasks] = useState<DesktopAgentTaskResponse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setError(null);
    try {
      const next = await fetchDesktopAgentTasks(session.access_token);
      setTasks(next);
      setSelectedId((current) => current && next.some((task) => task.taskId === current) ? current : next[0]?.taskId ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法加载任务历史"); }
    finally { setLoading(false); }
  }, [session?.access_token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const selected = tasks.find((task) => task.taskId === selectedId) ?? null;

  return <main className="desktop-agent-history">
    <header><div><p>HELSTERA / AGENT HISTORY</p><h1>Agent 任务历史</h1><span>任务计划、执行证据、截图与录屏</span></div><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true"/>刷新</button></header>
    {error ? <p role="alert" className="desktop-agent-history__error">{error}</p> : null}
    <div className="desktop-agent-history__body"><nav aria-label="Agent 任务列表">{loading && tasks.length === 0 ? <p className="desktop-agent-history__empty">正在加载任务…</p> : tasks.length === 0 ? <p className="desktop-agent-history__empty"><History aria-hidden="true"/>还没有 Agent 任务</p> : tasks.map((task) => <button key={task.taskId} type="button" aria-current={selectedId === task.taskId ? "true" : undefined} onClick={() => setSelectedId(task.taskId)}><strong>{task.goal}</strong><span>{modes[task.executionMode ?? "automatic"]} · {task.role}</span><small>{task.status} · {new Date(task.createdAt).toLocaleString()}</small></button>)}</nav><section aria-label="任务详情">{selected ? <DesktopAgentProgressCard key={selected.taskId} taskId={selected.taskId}/> : <p className="desktop-agent-history__empty">选择一个任务查看详情。</p>}</section></div>
  </main>;
}
