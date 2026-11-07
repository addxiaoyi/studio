"use client";

import { useRef, useState } from "react";
import { Bot, Sparkles, Upload, Undo2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudioAiWorkflow, type StudioWorkflowProps } from "@/hooks/use-studio-ai-workflow";
import { studioTargetLabel } from "@/lib/studio-ai-context";
import { useVideoText } from "@/lib/video-copy";
import { useLocale } from "@/lib/i18n";
import { StudioTimelineDiff } from "./studio-timeline-diff";

type Props = StudioWorkflowProps & { onViewTimeline?: () => void };

export function StudioAiEditorPanel(props: Props) {
  const flow = useStudioAiWorkflow(props);
  const copy = useVideoText();
  const english = useLocale() === "en-US";
  const [musicOpen, setMusicOpen] = useState(false);
  const musicInput = useRef<HTMLInputElement>(null);
  const locked = flow.busy || flow.restoring || flow.receiptPending;
  const selectedLabel = flow.context ? studioTargetLabel(flow.context) : "";
  const currentStage = flow.applied ? 3 : flow.plan ? 2 : 1;

  function chooseMusic() { setMusicOpen(true);if (!flow.audio.length) musicInput.current?.click(); }
  function importMusic() { musicInput.current?.click(); }
  function addTitle() { flow.addRequest(copy("在视频开头添加简短标题，保留现有画面。")); }
  function addCaption() { flow.addRequest(copy("根据当前画面添加简短说明字幕，保留现有画面。")); }
  function trimVideo() { flow.addRequest(copy("用已导入的视频素材整理剪辑节奏，先给出剪辑方案。")); }

  return <aside aria-label={copy("AI 编辑当前合成")} className="flex min-h-0 w-full shrink-0 flex-col bg-card text-card-foreground">
    <header className="border-b px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Bot className="size-4" aria-hidden="true" />{copy("AI 修改")}</h2>
      <ol aria-label={copy("修改流程")} className="mt-3 flex items-center gap-2 text-xs">
        {["描述要求", "确认方案", "预览与导出"].map((label, index) => <li key={label} aria-current={currentStage === index + 1 ? "step" : undefined} className={currentStage === index + 1 ? "font-semibold text-foreground" : "text-muted-foreground"}>{index + 1} {copy(label)}</li>)}
      </ol>
    </header>
    <div className="space-y-4 overflow-y-auto p-4">
      <section aria-label={copy("修改对象")} className="rounded-lg border bg-background p-3 text-xs">
        <p className="text-muted-foreground">{copy("修改对象")}</p>
        <p className="mt-1 break-all text-sm font-medium">{flow.target?.compositionId ?? copy("正在读取当前视频…")}</p>
        {flow.target && <p className="mt-1 text-muted-foreground">{flow.target.duration.toFixed(1)} {copy("秒")} · {copy(flow.target.format === "portrait" ? "竖屏" : "横屏")} · {copy("当前视频")}</p>}
        {selectedLabel && <div className="mt-2 flex items-start gap-2 border-t pt-2"><span className="min-w-0 flex-1 break-words">{copy("参考选中内容")}：{selectedLabel}</span><button type="button" disabled={locked} onClick={flow.removeContext} className="shrink-0 underline">{copy("移除")}</button></div>}
      </section>

      <div className="space-y-2">
        <label htmlFor="studio-edit-request" className="block text-sm font-medium">{copy("想怎样修改？")}</label>
        <textarea id="studio-edit-request" ref={flow.promptRef} aria-label={copy("描述视频编辑目标")} value={flow.prompt} onChange={event => flow.setPrompt(event.target.value)} placeholder={copy("例如：保留当前画面，在前两秒加上标题“新品上市”。")} rows={3} maxLength={4000} disabled={!props.runtime || flow.busy} className="w-full resize-y rounded-lg border bg-background p-3 text-base sm:text-sm" />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={locked || !flow.target} onClick={addTitle}>{copy("添加标题")}</Button>
          <Button size="sm" variant="outline" disabled={locked || !flow.target} onClick={addCaption}>{copy("添加字幕")}</Button>
          <Button size="sm" variant="outline" disabled={locked || !flow.target} onClick={chooseMusic}>{copy("添加配乐")}</Button>
          {flow.hasVideo && <Button size="sm" variant="outline" disabled={locked} onClick={trimVideo}>{copy("剪辑素材")}</Button>}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{copy("先预览修改方案，确认后才改变时间线。字幕文案由模型生成。")}</p>
      </div>

      <input ref={musicInput} type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,.mp3,.wav,.ogg,.m4a" aria-label={copy("导入背景音乐")} className="sr-only" onChange={event => { const file = event.target.files?.[0];event.target.value = "";if (file) void flow.importMusic(file); }} />
      <details open={musicOpen} onToggle={event => setMusicOpen(event.currentTarget.open)} className="rounded-lg border bg-background p-3">
        <summary className="cursor-pointer text-xs font-medium">{copy("背景音乐（可选）")}</summary>
        <div className="mt-3 space-y-3">
          {!flow.audio.length ? <div className="space-y-2"><p className="text-xs text-muted-foreground">{copy("当前工程还没有音乐，导入后即可设置起播时间和音量。")}</p><Button size="sm" variant="outline" disabled={locked} onClick={importMusic}><Upload className="size-3" />{copy("导入音乐")}</Button></div> : <>
            <label className="block text-xs">{copy("背景音乐素材")}<select aria-label={copy("背景音乐素材")} value={flow.music} onChange={event => flow.setMusic(event.target.value)} disabled={locked} className="mt-1 w-full rounded border bg-background p-2 text-base sm:text-sm"><option value="">{copy("不添加音乐")}</option>{flow.audio.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
            {flow.music && <><label className="block text-xs">{copy("音乐音量")} {flow.volume}%<input aria-label={copy("音乐音量")} type="range" min={0} max={100} value={flow.volume} onChange={event => flow.setVolume(Number(event.target.value))} disabled={locked} className="w-full" /></label><label className="block text-xs">{copy("音乐起播（秒）")}<input aria-label={copy("音乐起播（秒）")} type="number" min={0} max={Math.max(0, (flow.target?.duration ?? 7200) - 0.1)} step={0.1} value={flow.musicStart} onChange={event => flow.setMusicStart(Number(event.target.value))} disabled={locked} className="mt-1 w-full rounded border bg-background p-2 text-base sm:text-sm" /></label></>}
          </>}
        </div>
      </details>

      <Button className="w-full" disabled={!props.runtime || !flow.target || !flow.prompt.trim() || locked} onClick={flow.previewPlan}><Sparkles className="size-4" aria-hidden="true" />{copy(flow.restoring ? "正在恢复编辑记录…" : flow.busy ? "正在处理…" : "预览修改方案")}</Button>
      {!flow.prompt.trim() && !flow.restoring && <p className="text-xs text-muted-foreground">{copy("输入修改要求，或选择上方的常用操作。")}</p>}

      {flow.plan && <section className="space-y-3 rounded-lg border bg-background p-3" data-testid="studio-ai-plan">
        <h3 className="text-sm font-semibold">{copy(flow.completelyUndone ? "本次修改已全部撤销" : flow.applied ? "修改已应用" : "确认这些修改")}</h3>
        <p className="text-xs text-muted-foreground">{flow.plan.snapshot?.compositionId}</p>
        <p className="text-xs leading-5 text-muted-foreground">{flow.plan.summary}</p>
        <StudioTimelineDiff plan={flow.plan} undone={flow.undoneActions} applied={Boolean(flow.applied)} />
        <ol className="space-y-2 text-xs">{flow.plan.actions.map((action, index) => {
          const command = flow.plan?.commands?.actions[index];
          const label = !english || !command ? action.label : command.type === "caption" ? `Caption ${command.startMs / 1000}–${command.endMs / 1000}s: ${command.text}` : command.type === "cut" ? `Replace visuals: ${command.clips.map(clip => `${clip.name} ${clip.start}–${clip.end}s`).join("; ")}` : command.type === "audio" ? `Music: ${command.assetName}, ${command.startMs / 1000}s, ${Math.round(command.volume * 100)}%` : "Export MP4";
          const undone = flow.undoneActions.includes(index);
          return <li key={`${action.type}:${index}`} className="space-y-1" data-action-index={index}>
            <label className="flex items-start gap-2"><input type="checkbox" checked={flow.confirmed.has(index)} onChange={event => flow.toggleAction(index, event.target.checked)} disabled={flow.busy || Boolean(flow.applied)} /><span className={undone ? "text-muted-foreground line-through" : ""}>{label}</span></label>
            {undone ? <p className="pl-5 text-xs text-muted-foreground">{copy("已撤销")}</p> : flow.applied && flow.actionUndoAvailable && action.type !== "export" ? <button type="button" disabled={locked} onClick={() => void flow.undoAppliedAction(index)} aria-label={`${copy("撤销动作")} ${index + 1}`} className="ml-5 rounded border px-2 py-1 text-xs hover:bg-muted">{copy(action.type === "caption" ? "撤销此字幕" : action.type === "audio" ? "撤销此配乐" : "撤销剪辑")}</button> : null}
          </li>;
        })}</ol>
        {!flow.applied ? <><p className="text-xs text-muted-foreground">{copy("已确认")} {flow.confirmed.size}/{flow.plan.actions.length}</p><Button className="w-full" disabled={flow.busy || flow.confirmed.size !== flow.plan.actions.length} onClick={flow.applyPlan}>{copy("确认并应用修改")}</Button><Button variant="ghost" className="w-full" disabled={flow.busy} onClick={flow.discardPlan}>{copy("放弃方案，继续编辑要求")}</Button></> : <>
          {props.onViewTimeline && <Button variant="outline" className="w-full" onClick={props.onViewTimeline}>{copy("查看时间线")}</Button>}
          <Button className="w-full" disabled={locked || flow.exportedOnce && !flow.undoneActions.length} onClick={flow.exportVideo}><Download className="size-4" />{copy(flow.undoneActions.length ? "导出当前版本" : flow.exportedOnce ? "成片已保存" : "导出视频")}</Button>
          {flow.canUndo && <Button variant="ghost" className="w-full" disabled={locked} onClick={flow.undoPlan}><Undo2 className="size-3" />{copy("撤销本次修改")}</Button>}
          {!flow.canUndo && !flow.completelyUndone && flow.plan.actions.some(action => action.type !== "export") && <p className="text-xs text-muted-foreground">{copy("撤销记录不可用或视频已有后续编辑，请先使用时间线撤销。")}</p>}
        </>}
        {flow.receiptPending && <Button variant="outline" className="w-full" disabled={flow.busy} onClick={flow.retryReceipt}>{copy("重试同步记录")}</Button>}
      </section>}
      {flow.notice && <output aria-live="polite" className="block text-xs leading-5 text-muted-foreground">{copy(flow.notice)}</output>}
      {flow.error && <p role="alert" className="text-xs leading-5 text-destructive">{copy(flow.error)}</p>}
    </div>
  </aside>;
}
