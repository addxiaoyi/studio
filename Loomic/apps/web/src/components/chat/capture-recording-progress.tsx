import type { WebsiteCaptureTask } from "@helstera/shared";

export function CaptureRecordingProgress({ task }: { task: WebsiteCaptureTask }) {
  const progress = task.recordingProgress;
  if (!progress || task.status !== "running") return null;
  return <p className="mt-2 text-xs tabular-nums text-muted-foreground" aria-label="录像生成进度">
    已生成 {progress.renderedSeconds.toFixed(1)} / {progress.totalSeconds.toFixed(0)} 秒 · 第 {progress.pageIndex}/{progress.pageCount} 页
    {progress.remainingSeconds === null ? " · 正在估算剩余时间" : ` · 预计还需 ${progress.remainingSeconds < 60 ? `${progress.remainingSeconds} 秒` : `${Math.ceil(progress.remainingSeconds / 60)} 分钟`}`}
  </p>;
}

export function captureEventDetail(stage: string, detail: string) {
  if (stage !== "recording_progress") return detail;
  try {
    const metrics: unknown = JSON.parse(detail);
    if (metrics && typeof metrics === "object" && "renderedSeconds" in metrics && typeof metrics.renderedSeconds === "number") return `已生成 ${metrics.renderedSeconds.toFixed(1)} 秒`;
  } catch { return detail; }
  return "正在逐帧生成录像";
}
