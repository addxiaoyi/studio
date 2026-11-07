"use client";

import { AppSelect } from "@/components/ui/app-select";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { compileTranscript, transcriptExportSchema, type TranscriptEdit, type TranscriptTask, type TranscriptExport } from "@helstera/shared";
import { Button } from "@/components/ui/button";
import { oneTakeApi } from "@/lib/onetake-api";
import type { OneTakeCopy } from "@/lib/onetake-copy";
import { transcriptHistory } from "@/lib/onetake-edit";
import { useOneTakeMedia } from "@/hooks/use-onetake";
import type { StudioRuntime } from "@/lib/visualforge-runtime";
import type { StudioExport } from "@/lib/visualforge-storage";
import { TranscriptWords } from "./transcript-words";
import { OneTakeExportOptions } from "./export-options";
import { OneTakeExportResult } from "./export-result";

export function OneTakeTranscriptEditor({ task, token, userId, runtime, copy, burnAvailable, onSaved, onDirty, onExport }: { task: TranscriptTask; token: string; userId: string; runtime: StudioRuntime | null; copy: OneTakeCopy; burnAvailable: boolean; onSaved(): Promise<void>; onDirty(dirty: boolean): void; onExport(output: StudioExport): void }) {
  const transcript = task.transcript!;
  const [history, dispatch] = useReducer(transcriptHistory, { past: [], present: task.edit!, future: [] });
  const [baseline, setBaseline] = useState({ task, edit: task.edit! });
  const [options, setOptions] = useState(() => transcriptExportSchema.parse({ subtitle: { mode: burnAvailable ? "burn" : "soft" } }));
  const [exports, setExports] = useState<TranscriptExport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [previewEdits, setPreviewEdits] = useState(true);
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const prepareKey = useRef({ payload: "", key: "" });
  const { url, error: mediaError } = useOneTakeMedia(token, `tasks/${task.id}/source`);
  const edit = history.present;
  const dirty = JSON.stringify(edit) !== JSON.stringify(baseline.edit);
  const compiled = useMemo(() => { try { return { value: compileTranscript(transcript, edit), error: "" }; } catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : "编辑内容无效。" }; } }, [transcript, edit]);
  const refreshExports = useCallback(async () => { setExports(await oneTakeApi.exports(token, task.id)); }, [token, task.id]);
  useEffect(() => {
    const controller = new AbortController(); let pending = false;
    const poll = async () => {
      if (pending) return; pending = true;
      try { const list = await oneTakeApi.exports(token, task.id, controller.signal); if (!controller.signal.aborted) setExports(list); }
      catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取导出记录。"); }
      finally { pending = false; }
    };
    void poll(); const timer = setInterval(() => { void poll(); }, 2500);
    return () => { controller.abort(); clearInterval(timer); };
  }, [token, task.id]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const act = async (operation: () => Promise<void>) => { if (busy) return; setBusy(true); setError(""); try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试。"); } finally { setBusy(false); } };
  const save = () => act(async () => { const saved = await oneTakeApi.save(token, baseline.task, edit); setBaseline({ task: saved, edit }); await onSaved(); });
  const change = (next: TranscriptEdit) => dispatch({ type: "edit", edit: next });
  const undo = () => dispatch({ type: "undo" });
  const redo = () => dispatch({ type: "redo" });
  const fillers = () => change({ ...edit, words: edit.words.map((word, index) => transcript.words[index]!.kind === "filler" ? { ...word, deleted: true } : word) });
  const restoreFillers = () => change({ ...edit, words: edit.words.map((word, index) => transcript.words[index]!.kind === "filler" ? { ...word, deleted: false } : word) });
  const silences = () => change({ ...edit, silences: edit.silences.map(() => true) });
  const restoreSilences = () => change({ ...edit, silences: edit.silences.map(() => false) });
  const restore = () => change({ words: edit.words.map(word => ({ ...word, deleted: false })), silences: edit.silences.map(() => false) });
  const seek = (seconds: number) => { if (player.current) { const bounded = Math.max(0, Math.min(transcript.duration, seconds)); player.current.currentTime = bounded; setTime(bounded); } };
  const togglePlayback = () => {
    const media = player.current;
    if (!media) return;
    if (!media.paused) { media.pause(); return; }
    void media.play().catch(cause => setError(cause instanceof Error ? cause.message : copy.pendingFile));
  };
  const back = () => seek((player.current?.currentTime ?? time) - 5);
  const forward = () => seek((player.current?.currentTime ?? time) + 5);
  const playbackKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === " ") { event.preventDefault(); togglePlayback(); }
    if (event.key === "ArrowLeft") { event.preventDefault(); back(); }
    if (event.key === "ArrowRight") { event.preventDefault(); forward(); }
  };
  const updateTime = () => {
    if (!player.current) return;
    const seconds = player.current.currentTime;
    if (previewEdits && !player.current.paused && compiled.value) {
      const next = compiled.value.segments.find(segment => segment.end > seconds + 0.015);
      if (!next) { player.current.pause(); setTime(transcript.duration); return; }
      if (seconds < next.start) { seek(next.start); return; }
    }
    setTime(seconds);
  };
  const prepare = () => act(async () => {
    if (dirty) throw new Error(copy.unsaved);
    const checked = transcriptExportSchema.parse(options);
    const payload = JSON.stringify({ revision: baseline.task.revision, options: checked });
    if (prepareKey.current.payload !== payload) prepareKey.current = { payload, key: crypto.randomUUID() };
    await oneTakeApi.prepare(token, baseline.task, checked, prepareKey.current.key);
    // Reuse only while the request outcome is unknown; a new preview can replace an expired approval.
    prepareKey.current = { payload: "", key: "" };
    await refreshExports();
  });
  const subtitles = () => act(async () => {
    if (dirty) throw new Error(copy.unsaved);
    const blob = await oneTakeApi.media(token, `tasks/${task.id}/subtitles`);
    const link = document.createElement("a"); const href = URL.createObjectURL(blob);
    link.href = href; link.download = "subtitles.srt"; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  });
  const waveform = useMemo(() => (transcript.peaks ?? []).map((peak, index, peaks) => `M${index / peaks.length * 1000},${30 - peak * 28}v${Math.max(1, peak * 56)}`).join(" "), [transcript.peaks]);
  return <div className="min-w-0 space-y-4" onKeyDown={event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === "s") { event.preventDefault(); if (dirty && !busy) void save(); }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key.toLowerCase() === "z") { event.preventDefault(); if (!busy) dispatch({ type: event.shiftKey ? "redo" : "undo" }); }
  }}>
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" tabIndex={0} role="group" aria-label={copy.sourcePreview} onKeyDown={playbackKeys}>
        {url ? task.mimeType.startsWith("video/") ? <video ref={player} src={url} controls onTimeUpdate={updateTime} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} className="max-h-72 w-full rounded-lg bg-black" aria-label={copy.sourcePreview} /> : <audio ref={player} src={url} controls onTimeUpdate={updateTime} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} className="w-full" aria-label={copy.sourcePreview} /> : <p role="status" className="rounded-lg border p-6 text-sm">{copy.pendingFile}</p>}
        <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={!url} onClick={togglePlayback}>{playing ? copy.pause : copy.play}</Button><Button size="sm" variant="ghost" disabled={!url} onClick={back}>{copy.back}</Button><Button size="sm" variant="ghost" disabled={!url} onClick={forward}>{copy.forward}</Button><label className="text-sm">{copy.speed}<AppSelect value={speed} className="ml-2 rounded-md border bg-background p-2 text-base sm:text-sm" onChange={event => { const value = Number(event.target.value); setSpeed(value); if (player.current) player.current.playbackRate = value; }}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</AppSelect></label></div>
        {waveform && <svg viewBox="0 0 1000 60" preserveAspectRatio="none" className="h-16 w-full rounded-md bg-muted/40 text-primary" role="img" aria-label={copy.waveform}><path d={waveform} stroke="currentColor" strokeWidth="1" /><line x1={time / transcript.duration * 1000} x2={time / transcript.duration * 1000} y1="0" y2="60" stroke="currentColor" strokeWidth="3" /></svg>}
        <label className="block text-xs">{copy.seek} · {time.toFixed(2)} / {transcript.duration.toFixed(2)}<input type="range" min="0" max={transcript.duration} step="0.01" value={time} onChange={event => seek(Number(event.target.value))} className="mt-2 w-full" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={previewEdits} onChange={event => setPreviewEdits(event.target.checked)} />{copy.preview}</label>
        <p className="text-xs text-muted-foreground">{copy.shortcuts}</p>
      </div>
      <div className="min-w-0 space-y-3">
        <h3 className="break-words text-sm font-medium">{task.name}</h3>
        <p className="text-xs text-muted-foreground">{copy.expires}: {new Date(task.expiresAt).toLocaleString()}</p>
        <p className="text-sm">{copy.kept}: {compiled.value?.duration.toFixed(2) ?? "—"}s · {transcript.words.length} {copy.words}</p>
        <p className="text-xs text-muted-foreground">{copy.removedWords}: {edit.words.filter(word => word.deleted).length} · {copy.removedTime}: {compiled.value ? (transcript.duration - compiled.value.duration).toFixed(2) : "—"}s</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!history.past.length || busy} onClick={undo}>{copy.undo}</Button><Button size="sm" variant="outline" disabled={!history.future.length || busy} onClick={redo}>{copy.redo}</Button><Button size="sm" disabled={!dirty || busy || !compiled.value} onClick={save}>{busy ? copy.busy : copy.save}</Button></div>
        <p role="status" className="text-xs text-muted-foreground">{dirty ? copy.unsaved : copy.saved}</p>
        {task.revision !== baseline.task.revision && <p role="alert" className="text-sm text-destructive">{copy.conflict}</p>}
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={fillers}>{copy.removeFillers}</Button><Button size="sm" variant="outline" disabled={busy} onClick={silences}>{copy.removeSilences}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={restore}>{copy.resetSuggestions}</Button></div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={restoreFillers}>{copy.restoreFillers}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={restoreSilences}>{copy.restoreSilences}</Button></div>
        <Button size="sm" variant="outline" onClick={subtitles} disabled={busy || dirty}>{copy.subtitles}</Button>
      </div>
    </div>
    {(error || mediaError || compiled.error) && <p role="alert" className="break-words rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error || mediaError || compiled.error}</p>}
    <TranscriptWords transcript={transcript} edit={edit} onChange={change} seek={seek} time={time} copy={copy} disabled={busy} />
    {task.mimeType.startsWith("video/") ? <><OneTakeExportOptions options={options} onChange={setOptions} copy={copy} burnAvailable={burnAvailable} disabled={busy} /><Button onClick={prepare} disabled={dirty || busy || !compiled.value}>{copy.prepare}</Button></> : <p className="text-sm text-muted-foreground">{copy.audioOnly}</p>}
    <section aria-label={copy.exports} className="space-y-3"><h3 className="text-sm font-medium">{copy.exports}</h3>{!exports.length && <p className="text-xs text-muted-foreground">{copy.noExports}</p>}{exports.map(output => <OneTakeExportResult key={output.id} output={output} token={token} userId={userId} runtime={runtime} copy={copy} onRefresh={refreshExports} onExport={onExport} />)}</section>
  </div>;
}
