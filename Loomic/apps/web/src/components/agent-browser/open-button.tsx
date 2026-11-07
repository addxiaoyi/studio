"use client";
import { Monitor } from "lucide-react";
import { openAgentBrowser } from "@/lib/agent-browser-api";

export function AgentBrowserButton({
  taskId,
  compact = false,
}: { taskId?: string; compact?: boolean }) {
  function reveal() {
    openAgentBrowser(taskId);
  }
  return (
    <button
      type="button"
      onClick={reveal}
      title="查看 Agent 浏览器"
      aria-label="查看 Agent 浏览器"
      className={`flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground ${compact ? "justify-center px-0" : ""}`}
    >
      <Monitor className="size-[18px]" aria-hidden="true" />
      {!compact && <span>查看 Agent 浏览器</span>}
    </button>
  );
}
