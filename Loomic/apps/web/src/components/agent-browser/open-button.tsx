"use client";
import { Monitor } from "lucide-react";
import { openAgentBrowser } from "@/lib/agent-browser-api";

export function AgentBrowserButton({
  taskId,
  compact = false,
  mobile = false,
  className,
  tabIndex,
}: { taskId?: string; compact?: boolean; mobile?:boolean; className?:string; tabIndex?:number }) {
  function reveal() {
    openAgentBrowser(taskId);
  }
  return (
    <button
      type="button"
      onClick={reveal}
      title={taskId?"查看 Agent 浏览器":"展开 Agent 浏览器"}
      aria-label={taskId?"查看 Agent 浏览器":"展开 Agent 浏览器"}
      aria-controls="agent-browser-panel"
      tabIndex={tabIndex}
      className={className??(mobile?"flex min-h-14 min-w-10 flex-col items-center justify-center gap-0.5 text-[10px] text-muted-foreground":"flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"+(compact?" justify-center px-0":""))}
    >
      <Monitor className="size-[18px]" aria-hidden="true" />
      {!compact && <span>{mobile?"浏览":taskId?"查看 Agent 浏览器":"Agent 浏览器"}</span>}
    </button>
  );
}
