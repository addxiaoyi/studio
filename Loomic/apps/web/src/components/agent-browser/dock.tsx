"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  CirclePause,
  CirclePlay,
  Globe2,
  Monitor,
  RefreshCw,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/lib/i18n";
import { useAgentBrowsers } from "@/hooks/use-agent-browser";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
import { AgentCursor } from "./cursor";
import "./style.css";

export function AgentBrowserDock() {
  const {session}=useAuth();
  return session?<BrowserSessionDock key={session.user.id}/>:null;
}

function BrowserSessionDock() {
  const { session } = useAuth();
  const english = useLocale() === "en-US";
  const [open, setOpen] = useState(false),
    [wanted, setWanted] = useState<string | undefined>();
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLElement | null>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  const view = useAgentBrowsers(session?.access_token, open, wanted);
  const active = view.sessions.filter((item) =>
    ["running", "starting", "paused"].includes(item.state),
  ).length;
  const selected = view.selected;
  const labels = english
    ? {
        title: "Agent browser",
        subtitle: "Watch the isolated session",
        close: "Close browser panel",
        open: "Show Agent browser",
        empty: "No browser session yet",
        emptyHint:
          "Start a website task in chat. Its isolated browser will appear here.",
        loading: "Connecting to the browser…",
        retry: "Reconnect",
        paused: "Paused",
        starting: "Starting",
        running: "Live",
        completed: "Completed · last frame",
        failed: "Stopped · last frame",
        interrupted: "Disconnected · last frame",
        pause: "Pause at next action",
        resume: "Resume Agent",
        choose: "Browser task",
        enlarge: "Enlarge preview",
        restore: "Restore panel",
        privacy:
          "Only you can view this session. Folding the panel keeps the task running.",
        disabled: "Browser preview is not enabled on this server.",
        waiting: "Waiting for the first frame",
        history: "Task history",
      }
    : {
        title: "Agent 浏览器",
        subtitle: "查看隔离会话的真实操作",
        close: "关闭浏览器侧栏",
        open: "展开 Agent 浏览器",
        empty: "还没有浏览器会话",
        emptyHint: "在对话中发起浏览网站任务，隔离浏览器会显示在这里。",
        loading: "正在连接浏览器…",
        retry: "重新连接",
        paused: "已暂停",
        starting: "启动中",
        running: "实时画面",
        completed: "已完成 · 最后画面",
        failed: "已停止 · 最后画面",
        interrupted: "已断线 · 最后画面",
        pause: "下一动作前暂停",
        resume: "继续 Agent",
        choose: "浏览任务",
        enlarge: "放大预览",
        restore: "恢复侧栏",
        privacy: "仅你可查看此会话，折叠侧栏后任务继续运行。",
        disabled: "服务器尚未启用浏览器预览。",
        waiting: "等待第一帧画面",
        history: "任务记录",
      };
  function close() {
    setOpen(false);
    setExpanded(false);
    const visibleTrigger=trigger.current?.isConnected&&trigger.current.getClientRects().length?trigger.current:
      [...document.querySelectorAll<HTMLElement>('button[aria-controls="agent-browser-panel"]')].find(node=>node.getClientRects().length);
    visibleTrigger?.focus();
  }
  useEffect(() => {
    function reveal(event: Event) {
      const requested = (event as CustomEvent<{ taskId?: string }>).detail
        ?.taskId;
      setWanted(requested);
      view.select("");
      trigger.current = document.activeElement as HTMLElement;
      setOpen(true);
    }
    window.addEventListener("loomic:show-agent-browser", reveal);
    return () =>
      window.removeEventListener("loomic:show-agent-browser", reveal);
  }, []);
  useEffect(() => {
    if (!session) setOpen(false);
  }, [session?.user.id]);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    function escape(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        !document.querySelector('[role="listbox"],dialog[open]')
      ) {
        event.preventDefault();
        close();
      }
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);
  if (!session) return null;
  const displayState =
    selected && (view.frameError ? "interrupted" : selected.state);
  const terminal =
    displayState &&
    ["completed", "failed", "interrupted"].includes(displayState);
  return (
    <>
      {open && (
        <aside
          id="agent-browser-panel"
          className={`agent-browser-panel${expanded ? " agent-browser-panel-expanded" : ""}`}
          aria-label={labels.title}
        >
          <header className="agent-browser-header">
            <div>
              <h2>
                <Monitor aria-hidden="true" />
                {labels.title}
                {active>0&&<small className="text-xs font-normal text-muted-foreground">{active} {english?"active":"执行中"}</small>}
              </h2>
              <p>{labels.subtitle}</p>
            </div>
            <Button
              ref={closeButton}
              variant="ghost"
              size="icon"
              onClick={close}
              aria-label={labels.close}
            >
              <X />
            </Button>
          </header>
          <div className="agent-browser-content">
            {view.error && (
              <div role="alert" className="agent-browser-error">
                <p>{view.error}</p>
                <Button size="sm" variant="outline" onClick={view.retry}>
                  <RefreshCw />
                  {labels.retry}
                </Button>
              </div>
            )}
            {!view.enabled ? (
              <p role="status" className="agent-browser-empty">
                {labels.disabled}
              </p>
            ) : view.loading ? (
              <p role="status" className="agent-browser-empty">
                {labels.loading}
              </p>
            ) : !selected ? (
              <div className="agent-browser-empty">
                <Globe2 aria-hidden="true" />
                <h3>{labels.empty}</h3>
                <p>{labels.emptyHint}</p>
              </div>
            ) : (
              <>
                <StyledSelect
                  aria-label={labels.choose}
                  value={selected.id}
                  options={view.sessions.map((item) => ({
                    value: item.id,
                    label: item.title || item.name,
                    note: item.url || item.detail,
                    badge: labels[item.state],
                  }))}
                  onChange={view.select}
                />
                <div className="agent-browser-state">
                  <span data-state={displayState}>{labels[displayState!]}</span>
                  <span>
                    {selected.engine === "chromix" ? "Chromix" : "Chromium"}
                  </span>
                </div>
                <p className="agent-browser-url" title={selected.url}>
                  {selected.url || labels.waiting}
                </p>
                <div className="agent-browser-viewport">
                  {view.frame ? (
                    <img
                      src={view.frame}
                      alt={
                        english
                          ? `Browser page: ${selected.title}`
                          : `浏览器画面：${selected.title}`
                      }
                      draggable={false}
                    />
                  ) : (
                    <p role="status">{view.frameError || labels.waiting}</p>
                  )}
                  {view.frame && !terminal && (
                    <AgentCursor
                      cursor={selected.cursor}
                      width={selected.width}
                      height={selected.height}
                    />
                  )}
                </div>
                {view.frameError && view.frame && (
                  <p role="alert" className="agent-browser-error">
                    {view.frameError}
                  </p>
                )}
                <p className="agent-browser-detail" role="status">
                  {selected.detail}
                </p>
                <div className="agent-browser-actions">
                  {!terminal && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={view.busy}
                      onClick={view.setControl}
                    >
                      {selected.control === "paused" ? (
                        <CirclePlay />
                      ) : (
                        <CirclePause />
                      )}
                      {selected.control === "paused"
                        ? labels.resume
                        : labels.pause}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setExpanded((value) => !value)}
                  >
                    <ArrowUpRight />
                    {expanded ? labels.restore : labels.enlarge}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={view.retry}>
                    <RefreshCw />
                    {labels.retry}
                  </Button>
                </div>
                <p className="agent-browser-meta">
                  {new Date(selected.updatedAt).toLocaleTimeString()} ·{" "}
                  {selected.width} × {selected.height}
                </p>
              </>
            )}
          </div>
          <footer className="agent-browser-footer">
            <p>{labels.privacy}</p>
            <a href="/agent-history/">
              {labels.history}
              <ArrowUpRight aria-hidden="true" />
            </a>
          </footer>
        </aside>
      )}
    </>
  );
}
