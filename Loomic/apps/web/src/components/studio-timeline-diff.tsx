"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Button } from "./ui/button";
import { studioTimelineDiff, type TimelineSpan, type TimelineVersion } from "@/lib/studio-timeline-diff";
import type { StudioAiPlan } from "@/lib/studio-ai-edit";
import { useLocale } from "@/lib/i18n";
import { studioActionLabel } from "@/lib/studio-action-label";
import {StudioMotionPreview} from "./studio-motion-preview";

type Props = { plan: StudioAiPlan; undone: readonly number[]; applied: boolean };
const time = (seconds: number) => `${Number(seconds.toFixed(2))}s`;

export function StudioTimelineDiff({ plan, undone, applied }: Props) {
  const english = useLocale() === "en-US";
  const diff = studioTimelineDiff(plan, undone);
  const [selected, setSelected] = useState<TimelineSpan | null>(null);
  if (!diff) return null;
  function version(title: string, timeline: TimelineVersion) {
    return <section aria-label={title} className="min-w-0 rounded-lg border bg-background p-3">
      <h3 className="flex justify-between gap-2 text-sm font-semibold"><span>{title}</span><span>{time(timeline.duration)} · {timeline.format === "portrait" ? english ? "Portrait" : "竖屏" : english ? "Landscape" : "横屏"}</span></h3>
      <div className="my-3 flex justify-between text-[11px] text-muted-foreground" aria-hidden="true"><span>0</span><span>{time(diff!.scale / 2)}</span><span>{time(diff!.scale)}</span></div>
      {([['video',english?'Visuals':'画面'],['captions',english?'Captions':'字幕'],['audio',english?'Music':'配乐']] as const).map(([track, label]) => <div key={track} className="mb-4 space-y-1">
        <h4 className="text-xs font-medium">{label}</h4>
        {!timeline[track].length && <p className="rounded border border-dashed px-2 py-1 text-xs text-muted-foreground">{track === "audio" && !timeline.audioKnown ? english ? "Existing audio is not fully mapped; composition is preserved." : "原有音轨未完整解析，保留原合成。" : english ? "None" : "无"}</p>}
        {timeline[track].map(span => <div key={span.id} className="relative min-h-9 overflow-hidden rounded bg-muted/50">
          <button type="button" onClick={() => setSelected(span)} title={`${span.label} · ${time(span.start)}–${time(span.end)}${span.detail ? ` · ${span.detail}` : ''}`} aria-label={`${label}: ${span.label}, ${time(span.start)}–${time(span.end)}`}
            className={`absolute inset-y-0 min-w-2 overflow-hidden rounded border px-2 text-left text-xs focus-visible:outline focus-visible:outline-2 ${span.change === "existing" ? "border-border bg-muted text-foreground" : track === "audio" ? "border-emerald-600 bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100" : track === "captions" ? "border-violet-500 bg-violet-100 text-violet-950 dark:bg-violet-950 dark:text-violet-100" : "border-blue-500 bg-blue-100 text-blue-950 dark:bg-blue-950 dark:text-blue-100"}`}
            style={{ left: `${span.start / diff!.scale * 100}%`, width: `${Math.max(0,span.end - span.start) / diff!.scale * 100}%` }}>
            <span className="block truncate">{span.change !== "existing" ? `${span.change === 'replaced' ? english?'Replace':'替换' : english?'Add':'新增'} · ` : ''}{span.label}</span>
          </button>
        </div>)}
      </div>)}
    </section>;
  }
  return <Dialog onOpenChange={open => { if (!open) setSelected(null); }}>
    <DialogTrigger render={<Button variant="outline" className="w-full" />}>{english ? "Compare timeline changes" : "查看时间线差异"}</DialogTrigger>
    <DialogContent className="max-h-[90dvh] w-[calc(100vw-24px)] overflow-y-auto sm:max-w-5xl">
      <DialogHeader><DialogTitle>{english ? "Timeline changes" : "时间线差异预览"}</DialogTitle><DialogDescription>{english ? "Compare timing on the same scale. This preview does not change the video." : "用同一时间刻度比较画面、字幕和配乐。本预览不修改视频。"}</DialogDescription></DialogHeader>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        {version(english ? "Before" : "修改前", diff.before)}
        {version(applied ? english ? "Current plan result" : "当前方案结果" : english ? "After confirmation" : "确认后", diff.after)}
      </div>
      <p className="text-xs text-muted-foreground">{english ? "Gray: existing · Blue: replacement · Purple: captions · Green: music. Each bar also names the change." : "灰色为原内容，蓝色为替换画面，紫色为字幕，绿色为配乐；条块同时标明变更类型。"}</p>
      {!!diff.details.length&&<ul className="space-y-2 text-sm">{diff.details.map(item=><li key={item.index} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{english?"Before":"修改前"}：{item.before}</p><p className="mt-1">{english?"Action":"动作"} {item.index+1} · {studioActionLabel(item.action,plan.snapshot,english)}</p>{item.action.type==="keyframes"&&<StudioMotionPreview tracks={item.action.tracks} english={english}/>}</li>)}</ul>}
      {selected && <output className="block rounded border p-3 text-sm" aria-live="polite">{selected.label} · {time(selected.start)}–{time(selected.end)}{selected.detail && ` · ${selected.detail}`}{selected.actionIndex !== undefined && ` · ${english?'Action':'动作'} ${selected.actionIndex + 1}`}</output>}
      {diff.exportPlanned && <p className="text-xs text-muted-foreground">{english ? "Export creates a file after a separate confirmation; it does not change timeline tracks." : "导出另行确认后生成文件，不改变时间线轨道。"}</p>}
    </DialogContent>
  </Dialog>;
}
