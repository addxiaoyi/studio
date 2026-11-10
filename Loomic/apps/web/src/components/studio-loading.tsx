"use client";
import { Button } from "@/components/ui/button";
import { studioPhaseLabels, type StudioStartup } from "@/lib/studio-startup";
import { useLocale } from "@/lib/i18n";

const english = { runtime: "Loading editor components", project: "Restoring your local project", download: "Downloading compiler resources", compile: "Compiling the video project", preview: "Preparing timeline preview", ready: "Editor ready" };

export function StudioLoading({ state, error, onRetry }: { state: StudioStartup; error?: string; onRetry(): void }) {
  const en = useLocale() === "en-US";
  const label = en ? english[state.phase] : studioPhaseLabels[state.phase];
  const progress = state.totalBytes ? Math.min(100, Math.round((state.loadedBytes ?? 0) / state.totalBytes * 100)) : undefined;
  return <section aria-label={en ? "Editor startup" : "编辑器启动进度"} className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-background/95 p-5">
    <div className="w-full max-w-md space-y-4">
      <p role="status" className="text-sm font-medium">{error ? (en ? "The editor could not start" : "编辑器暂时无法打开") : state.timedOut ? (en ? "Editor startup took too long" : "编辑器启动超时") : label}</p>
      <p className="text-sm text-muted-foreground">{en ? `Elapsed ${state.elapsedSeconds}s` : `已等待 ${state.elapsedSeconds} 秒`}{progress !== undefined && ` · ${progress}%`}</p>
      {progress !== undefined && !state.timedOut && !error && <progress className="h-2 w-full accent-primary" value={progress} max={100} aria-label={label} />}
      <p className="text-sm leading-relaxed text-muted-foreground">{en ? "Retrying does not delete saved files. You can reopen the editor or visit another project view." : "重试不会删除已保存的文件。可以重新打开编辑器，也可以先查看工程的其他视图。"}</p>
      {(error || state.timedOut || state.elapsedSeconds >= 10) && <Button variant="outline" onClick={onRetry}>{en ? "Reopen saved project" : "重新打开已保存工程"}</Button>}
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-2">{en ? "Startup details" : "查看启动详情"}</summary><p className="break-words py-2">{label} · {state.phaseSeconds}s{state.loadedBytes !== undefined && ` · ${(state.loadedBytes / 1048576).toFixed(1)} MB`}</p></details>
    </div>
  </section>;
}
