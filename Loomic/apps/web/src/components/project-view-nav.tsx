"use client";

import { projectViewHref, type ProjectContext, type ProjectView } from "@helstera/shared";
import { useState, type MouseEvent } from "react";
import { useLocale } from "@/lib/i18n";
import { StyledSelect } from "./ui/styled-select";

const views: { value: ProjectView; zh: string; en: string }[] = [
  { value: "canvas", zh: "画布", en: "Canvas" }, { value: "workflow", zh: "工作流", en: "Workflow" },
  { value: "timeline", zh: "时间线", en: "Timeline" }, { value: "video", zh: "视频剪辑", en: "Video" },
  { value: "conversation", zh: "对话", en: "Chat" },
];

export function ProjectViewNav({ context, current, desktop = false, compact = false, disabled = false, beforeNavigate }: {
  context: ProjectContext; current: ProjectView; desktop?: boolean; compact?: boolean; disabled?: boolean;
  beforeNavigate?(view: ProjectView): Promise<void>;
}) {
  const english = useLocale() === "en-US";
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  async function navigate(view: ProjectView) {
    if (disabled || busy || view === current) return;
    setBusy(true); setError("");
    try { await beforeNavigate?.(view); window.location.assign(projectViewHref(context,view,desktop)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : english ? "Save failed. Your work remains open." : "保存失败，当前工程仍保留，请重试。"); setBusy(false); }
  }
  function visit(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const view = event.currentTarget.dataset.view as ProjectView;
    void navigate(view);
  }
  const changeView = (view: string) => { void navigate(view as ProjectView); };
  return <nav aria-label={english ? "Project views" : "工程视图"} className="min-w-0 max-w-full">
    <div className={compact ? "w-36 max-w-full" : "sm:hidden"}>
      <StyledSelect aria-label={english ? "Switch project view" : "切换工程视图"} value={current} options={views.map(view => ({ value:view.value,label:english?view.en:view.zh }))} onChange={changeView} disabled={disabled || busy}/>
    </div>
    {!compact && <div className="hidden flex-wrap items-center gap-1 sm:flex">
      {views.map(view => <a key={view.value} href={projectViewHref(context,view.value,desktop)} data-view={view.value} onClick={visit} aria-current={current===view.value?"page":undefined} aria-disabled={disabled || busy} className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${current===view.value?"bg-muted font-medium text-foreground":"text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
        {english?view.en:view.zh}
      </a>)}
    </div>}
    {busy && <span role="status" className="sr-only">{english?"Saving before switching views":"正在保存工程后切换视图"}</span>}
    {disabled && <span role="status" className="sr-only">{english?"Preparing the project before switching views":"正在准备工程保存，完成后可切换视图"}</span>}
    {error && <p role="alert" className="max-w-md text-xs text-destructive">{error}</p>}
  </nav>;
}
