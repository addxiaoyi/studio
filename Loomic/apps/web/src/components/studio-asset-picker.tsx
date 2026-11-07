"use client";

import { AppSelect } from "@/components/ui/app-select";

import { useState, type ChangeEvent } from "react";
import { fetchGeneratedAssets, type GeneratedAsset } from "@/lib/server-api";
import { readStudioAsset, MAX_STUDIO_MEDIA_BYTES } from "@/lib/studio-media";
import { Button } from "@/components/ui/button";
import { useVideoText } from "@/lib/video-copy";

export function StudioAssetPicker({ token, importAsset, disabled = false }: { token: string; importAsset(file: File, assetId?: string): Promise<void>; disabled?: boolean }) {
  const copy = useVideoText();
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
      if (!asset.assetObjectId) throw new Error("素材缺少文件标识，请刷新素材库后重试。");
      await importAsset(await readStudioAsset(token, asset.assetObjectId), asset.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
    <label className="relative inline-flex h-8 max-w-full items-center overflow-hidden rounded-lg border bg-background px-3 text-xs focus-within:ring-2 focus-within:ring-ring">{copy("导入本机素材")}<input type="file" aria-label={copy("导入本机素材")} accept="image/*,video/*,audio/*" multiple disabled={busy || disabled} onChange={importLocal} className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" /></label>
    <Button type="button" data-studio-assets size="sm" variant="outline" onClick={load} disabled={busy}>{copy(busy ? "正在处理…" : "从 Loomic 素材库导入")}</Button>
    {assets && <><AppSelect aria-label={copy("选择素材")} value={selected} onChange={event => setSelected(event.target.value)} className="max-w-48 rounded-lg border bg-background p-1.5 text-base sm:text-xs"><option value="">{copy(assets.length ? "选择图片或视频" : "素材库暂无可用素材")}</option>{assets.map(asset => <option key={asset.id} value={asset.id}>{asset.title || asset.id}</option>)}</AppSelect><Button type="button" size="sm" variant="outline" disabled={!selected || busy || disabled} onClick={add}>{copy("导入编辑器")}</Button>{!assets.length && <a className="underline" href="/assets/">{copy("前往素材库")}</a>}</>}
    {error && <p role="alert" className="text-destructive">{copy(error)}</p>}
  </div>;
}
