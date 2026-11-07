"use client";

import { AppSelect } from "@/components/ui/app-select";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { oneTakeApi } from "@/lib/onetake-api";
import { useOneTake } from "@/hooks/use-onetake";
import { useLocale } from "@/lib/i18n";
import { oneTakeCopy } from "@/lib/onetake-copy";
import type { StudioRuntime } from "@/lib/visualforge-runtime";
import type { StudioExport } from "@/lib/visualforge-storage";
import { OneTakeTranscriptEditor } from "./transcript-editor";

export function OneTakeWorkspace({ token, userId, runtime, onExport, onDirty }: { token: string; userId: string; runtime: StudioRuntime | null; onExport(output: StudioExport): void; onDirty(dirty: boolean): void }) {
  const copy = oneTakeCopy(useLocale());
  const [selected, setSelected] = useState("");
  const { tasks, task, capabilities, loading, error: loadError, refresh } = useOneTake(token, selected);
  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState("base");
  const [language, setLanguage] = useState("auto");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [projectMedia, setProjectMedia] = useState("");
  const requestKey = useRef(crypto.randomUUID());
  const models = capabilities?.models ?? ["base"];
  const selectedModel = models.includes(model) ? model : models[0] ?? "base";
  const changed = useCallback((value: boolean) => { setDirty(value); onDirty(value); }, [onDirty]);
  useEffect(() => {
    try { setSelected(localStorage.getItem(`loomic.onetake.selected.${userId}`) ?? ""); }
    catch { setError("无法读取上次选择的任务，请从历史中选择。"); }
  }, [userId]);
  const select = (id: string) => {
    setSelected(id);
    try { localStorage.setItem(`loomic.onetake.selected.${userId}`, id); }
    catch { setError("任务已选择，但浏览器未能记住选择。"); }
  };
  const act = async (operation: () => Promise<void>) => { if (busy) return; setBusy(true); setError(""); try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : "文字剪辑操作失败。"); } finally { setBusy(false); } };
  const choose = (media: File) => { setFile(media); requestKey.current = crypto.randomUUID(); setConsent(false); };
  const chooseLocal = (event: ChangeEvent<HTMLInputElement>) => { const media = event.target.files?.[0]; event.target.value = ""; if (media) choose(media); };
  const chooseProject = () => act(async () => { if (runtime && projectMedia) choose(await runtime.readMedia(projectMedia)); });
  const upload = () => act(async () => {
    if (!file || !consent || !capabilities?.available) return;
    if (!file.size || file.size > capabilities.maxBytes) throw new Error(copy.uploadHint);
    const created = await oneTakeApi.upload(token, file, requestKey.current, selectedModel, language);
    select(created.id); setFile(null); setConsent(false); await refresh();
  });
  const retry = () => act(async () => { if (task) { await oneTakeApi.retry(token, task.id); await refresh(); } });
  const cancel = () => act(async () => { if (task) { await oneTakeApi.cancel(token, task.id); await refresh(); } });
  const reload = () => act(async () => { await refresh(); });
  const media = runtime?.listMedia().filter(item => /^(video|audio)\//.test(item.mimeType)) ?? [];
  return <section aria-label={copy.title} className="min-w-0 space-y-4 p-4 sm:p-5">
    <header><h2 className="text-base font-semibold">{copy.title}</h2><p className="mt-1 text-sm text-muted-foreground">{copy.description}</p><p className="mt-1 text-xs text-muted-foreground">{copy.switchHint}</p></header>
    <details open={!tasks.length} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{copy.source}</summary>
      <fieldset disabled={busy || dirty} className="mt-3 space-y-3">
        <label className="block text-sm">{copy.source}<input type="file" accept="video/*,audio/*" onChange={chooseLocal} className="mt-2 block w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-2 file:text-foreground" /></label>
        {!!media.length && <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">{copy.projectSource}<AppSelect value={projectMedia} onChange={event => setProjectMedia(event.target.value)} className="mt-1 w-full rounded-md border bg-background p-2 text-base sm:text-sm"><option value="">{copy.pickSource}</option>{media.map(item => <option key={item.name}>{item.name}</option>)}</AppSelect></label><Button size="sm" variant="outline" onClick={chooseProject} disabled={!projectMedia}>{copy.source}</Button></div>}
        <div className="flex flex-wrap gap-3"><label className="text-sm">{copy.model}<AppSelect value={selectedModel} onChange={event => { setModel(event.target.value); requestKey.current = crypto.randomUUID(); }} className="ml-2 rounded-md border bg-background p-2 text-base sm:text-sm">{models.map(name => <option key={name}>{name}</option>)}</AppSelect></label><label className="text-sm">{copy.language}<AppSelect value={language} onChange={event => { setLanguage(event.target.value); requestKey.current = crypto.randomUUID(); }} className="ml-2 rounded-md border bg-background p-2 text-base sm:text-sm">{[["auto", copy.auto], ["zh", "中文"], ["en", "English"], ["ja", "日本語"], ["ko", "한국어"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</AppSelect></label></div>
        <p className="text-xs text-muted-foreground">{copy.uploadHint}</p>
        {file && <p className="break-words text-sm">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1" />{copy.uploadConsent}</label>
        <Button onClick={upload} disabled={!file || !consent || !capabilities?.available}>{busy ? copy.busy : copy.upload}</Button>
        {capabilities && !capabilities.available && <p role="status" className="text-sm text-muted-foreground">{copy.noRuntime}: {capabilities.reason}</p>}
      </fieldset>
    </details>
    {(error || loadError) && <p role="alert" className="break-words rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error || loadError}</p>}
    <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">{copy.history}<AppSelect value={selected} onChange={event => select(event.target.value)} disabled={dirty || busy} className="mt-1 w-full rounded-md border bg-background p-2 text-base sm:text-sm"><option value="">{copy.history}</option>{tasks.map(item => <option key={item.id} value={item.id}>{item.name} · {copy[item.state]}</option>)}</AppSelect></label><Button size="sm" variant="outline" onClick={reload} disabled={busy}>{copy.refresh}</Button></div>
    {loading && <p role="status" className="text-sm">{copy.loading}</p>}
    {!loading && !tasks.length && <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{copy.empty}</p>}
    {task && task.state !== "completed" && <div className="space-y-3 rounded-lg border p-4"><p role="status" className="text-sm">{task.name} · {copy[task.state]}</p>{task.error && <p role="alert" className="text-sm text-destructive">{task.error}</p>}{["failed", "canceled"].includes(task.state) ? <Button size="sm" variant="outline" onClick={retry} disabled={busy}>{copy.retry}</Button> : <Button size="sm" variant="outline" onClick={cancel} disabled={busy}>{copy.cancel}</Button>}</div>}
    {task?.state === "completed" && task.transcript && task.edit && <OneTakeTranscriptEditor key={task.id} task={task} token={token} userId={userId} runtime={runtime} copy={copy} burnAvailable={capabilities?.burnSubtitles ?? false} onSaved={refresh} onDirty={changed} onExport={onExport} />}
  </section>;
}
