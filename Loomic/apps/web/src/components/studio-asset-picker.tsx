"use client";

import { useState, type ChangeEvent } from "react";
import { fetchGeneratedAssets, type GeneratedAsset } from "@/lib/server-api";
import { readStudioAsset, MAX_STUDIO_MEDIA_BYTES } from "@/lib/studio-media";
import { Button } from "@/components/ui/button";

export function StudioAssetPicker({ token, importAsset, disabled = false }: { token: string; importAsset(file: File, assetId?: string): Promise<void>; disabled?: boolean }) {
  const [assets, setAssets] = useState<GeneratedAsset[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function importLocal(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    if (busy || !files.length) return;
    setBusy(true); setError("");
    try {
      for (const file of files) {
        if (!/^(image|video|audio)\//.test(file.type) || file.size > MAX_STUDIO_MEDIA_BYTES || file.size === 0) {
          throw new Error("请选择非空图片、音频或视频，每个文件不超过 250 MB。");
        }
        await importAsset(file);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "本机素材导入失败。"); }
    finally { setBusy(false); }
  }
  async function load() {
    setBusy(true); setError("");
    try { const reply = await fetchGeneratedAssets(token); setAssets(reply.assets); }
    catch { setError("无法加载素材库，请重试。"); }
    finally { setBusy(false); }
  }
  async function add() {
    const asset = assets?.find(item => item.id === selected);
    if (!asset || busy || disabled) return;
    setBusy(true); setError("");
    try {
      await importAsset(await readStudioAsset(token, asset.id), asset.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
    <label className="relative inline-flex h-8 max-w-full items-center overflow-hidden rounded-lg border bg-background px-3 text-xs focus-within:ring-2 focus-within:ring-ring">导入本机素材<input type="file" aria-label="导入本机素材" accept="image/*,video/*,audio/*" multiple disabled={busy || disabled} onChange={importLocal} className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" /></label>
    <Button type="button" size="sm" variant="outline" onClick={load} disabled={busy}>{busy ? "正在处理…" : "从 Loomic 素材库导入"}</Button>
    {assets && <><select aria-label="选择素材" value={selected} onChange={event => setSelected(event.target.value)} className="max-w-48 rounded-lg border bg-background p-1.5 text-xs"><option value="">{assets.length ? "选择图片或视频" : "素材库暂无可用素材"}</option>{assets.map(asset => <option key={asset.id} value={asset.id}>{asset.title || asset.id}</option>)}</select><Button type="button" size="sm" variant="outline" disabled={!selected || busy || disabled} onClick={add}>导入编辑器</Button></>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
