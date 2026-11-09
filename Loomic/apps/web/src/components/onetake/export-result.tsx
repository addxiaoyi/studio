"use client";

import { useState } from "react";
import type { TranscriptExport } from "@helstera/shared";
import { Button } from "@/components/ui/button";
import { SendVideoToChat } from "@/components/send-video-to-chat";
import { useOneTakeMedia } from "@/hooks/use-onetake";
import { oneTakeApi } from "@/lib/onetake-api";
import { applyOneTakeExport, oneTakeEditId } from "@/lib/onetake-composition";
import type { OneTakeCopy } from "@/lib/onetake-copy";
import type { StudioRuntime, StudioSnapshot } from "@/lib/visualforge-runtime";
import { saveStudioExport, type StudioExport } from "@/lib/visualforge-storage";

export function OneTakeExportResult({ output, token, userId, runtime, copy, onRefresh, onExport }: { output: TranscriptExport; token: string; userId: string; runtime: StudioRuntime | null; copy: OneTakeCopy; onRefresh(): Promise<void>; onExport(output: StudioExport): void }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [assetId, setAssetId] = useState("");
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [applied, setApplied] = useState(false);
  const [importedFile, setImportedFile] = useState<StudioExport | null>(null);
  const { url, error: mediaError } = useOneTakeMedia(token, output.state === "completed" ? `exports/${output.id}/file` : null);
  const act = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(""); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "导出操作失败，请重试。"); } finally { setBusy(false); } };
  const confirm = () => act(async () => { if (!checked) return; await oneTakeApi.confirm(token, output); await onRefresh(); });
  const cancel = () => act(async () => { await oneTakeApi.cancelExport(token, output.id); await onRefresh(); });
  const save = () => act(async () => { setAssetId((await oneTakeApi.saveAsset(token, output.id)).assetId); });
  const inspect = () => act(async () => {
    if (!runtime) return;
    const blob = await oneTakeApi.media(token, `exports/${output.id}/file`);
    const name = `Helstera-${output.id}.mp4`;
    await runtime.importAsset(new File([blob], name, { type: "video/mp4" }), output.id);
    const imported = await runtime.readAsset(output.id);
    if (!imported) throw new Error("成片导入未完成，请重试。");
    setImportedFile({ id: output.id, name: imported.name, blob, createdAt: Date.now(), ...(assetId ? { assetId } : {}) });
    const current = await runtime.snapshot();
    const alreadyApplied = current.appliedEdits?.includes(await oneTakeEditId(output.id, current.compositionId)) ?? false;
    setApplied(alreadyApplied);
    setSnapshot(alreadyApplied ? null : current);
  });
  const apply = () => act(async () => {
    if (!runtime || !snapshot || !importedFile) return;
    await applyOneTakeExport(runtime, snapshot, output, importedFile.name);
    await saveStudioExport(userId, importedFile); onExport(importedFile); setApplied(true); setSnapshot(null);
  });
  return <article className="min-w-0 space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><strong>{output.options.format.toUpperCase()} · {output.duration.toFixed(2)}s</strong><span role="status">{copy[output.state]}</span></div>
    <p className="break-words text-xs text-muted-foreground">{copy[output.options.aspect]} · {copy[output.options.quality]} · {output.options.subtitle.enabled ? `${copy[output.options.subtitle.mode]} / ${output.options.subtitle.font} / ${output.options.subtitle.size === null ? copy.autoSize : `${output.options.subtitle.size}px`} / ${copy[output.options.subtitle.position]} / ${output.options.subtitle.color} / ${output.options.subtitle.outlineColor} / ${output.options.subtitle.outlineWidth}px` : copy.subtitle + ": —"}</p>
    {output.state === "pending" && <><p className="text-xs text-muted-foreground">{copy.exportNotice}</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} className="mt-1" />{copy.exportConsent}</label><Button size="sm" onClick={confirm} disabled={!checked || busy}>{copy.confirm}</Button></>}
    {["pending", "queued", "running"].includes(output.state) && <Button className="ml-2" size="sm" variant="outline" onClick={cancel} disabled={busy}>{copy.cancel}</Button>}
    {output.state === "completed" && <>
      {url ? output.options.format === "mp4" ? <video controls src={url} className="max-h-64 w-full rounded-md bg-black" aria-label={copy.download} /> : <p className="text-xs text-muted-foreground">{copy.movHint}</p> : <p role="status" className="text-xs">{copy.pendingFile}</p>}
      <div className="flex flex-wrap gap-2">{url && <a href={url} download={`Helstera-${output.id}.${output.options.format}`} className="rounded-md border px-3 py-2 text-sm">{copy.download}</a>}
        {output.options.format === "mp4" && <><Button size="sm" variant="outline" disabled={busy || !!assetId} onClick={save}>{assetId ? copy.savedAsset : copy.saveAsset}</Button><Button size="sm" variant="outline" disabled={busy || !runtime || applied} onClick={inspect}>{applied ? copy.applied : copy.useCurrent}</Button></>}
      </div>
      {assetId && <SendVideoToChat assetId={assetId} token={token} />}
      {snapshot && <div className="space-y-2 rounded-md border border-primary/40 p-3"><p className="break-words text-sm">{snapshot.compositionId}: {copy.applyNotice}</p><Button size="sm" onClick={apply} disabled={busy}>{copy.applyCurrent}</Button><Button size="sm" variant="ghost" onClick={() => setSnapshot(null)} disabled={busy}>{copy.cancel}</Button></div>}
    </>}
    {(error || output.error || mediaError) && <p role="alert" className="break-words text-sm text-destructive">{error || output.error || mediaError}</p>}
  </article>;
}
