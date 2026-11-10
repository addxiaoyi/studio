"use client";

import { useEffect, useRef, useState } from "react";
import { fetchGeneratedAssets, type GeneratedAsset } from "@/lib/server-api";
import { readStudioAsset } from "@/lib/studio-media";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { StyledSelect } from "./ui/styled-select";

export function FashionAssetPicker({ token, target, finish }: {
  token: string; target: "person" | "garment"; finish(file: File | null): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const confirmLock = useRef(false);
  useEffect(() => { dialog.current?.showModal(); return () => request.current?.abort(); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setSelected("");
    const timer = setTimeout(() => {
      void fetchGeneratedAssets(token, { mediaType:"image", query, page, pageSize:30 }).then(reply => {
        if (!active) return;
        setAssets(reply.assets.filter(asset => asset.mediaType === "image" && asset.assetObjectId && (!asset.retentionUntil || Date.parse(asset.retentionUntil) > Date.now())));
        setMore(reply.pagination.hasMore);
      }).catch(cause => { if(active) setError(cause instanceof Error ? cause.message : "素材库加载失败，请重试。"); })
        .finally(() => { if(active) setLoading(false); });
    }, 200);
    return () => { active=false; clearTimeout(timer); };
  }, [token, query, page, attempt]);
  async function selectImage() {
    const asset = assets.find(item => item.id === selected);
    if (!asset?.assetObjectId || confirmLock.current) return;
    confirmLock.current = true; setBusy(true); setError("");
    const abort = new AbortController(); request.current = abort;
    const deadline = setTimeout(() => abort.abort(), 30000);
    try {
      const file = await readStudioAsset(token, asset.assetObjectId, abort.signal, 8 * 1024 * 1024);
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("试穿仅支持 JPG、PNG 或 WebP 图片，最大 8 MB。");
      if (!abort.signal.aborted) finish(file);
    } catch (cause) {
      setError(abort.signal.aborted ? "素材读取超时，请重试。" : cause instanceof Error ? cause.message : "素材读取失败。");
    } finally { clearTimeout(deadline); confirmLock.current=false; setBusy(false); }
  }
  const close = () => { request.current?.abort(); finish(null); };
  return <dialog ref={dialog} onCancel={event => {event.preventDefault();close();}} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/50" aria-labelledby="fashion-picker-title">
    <h2 id="fashion-picker-title" className="text-lg font-semibold">选择{target === "person" ? "人物照片" : "服装参考图"}</h2>
    <p className="mb-4 mt-2 text-sm text-muted-foreground">仅列出当前账号可访问的图片。导入会重新检查权限，生成仍需单独确认费用。</p>
    <Input aria-label="搜索试穿素材" value={query} onChange={event => {setQuery(event.target.value);setPage(1);}} placeholder="搜索素材名称" disabled={busy}/>
    <div className="my-4 space-y-3">
      {loading ? <p role="status">正在读取素材库…</p> : assets.length ? <StyledSelect aria-label="试穿参考素材" value={selected} options={assets.map(asset => ({value:asset.id,label:asset.title || "未命名图片",note:asset.retentionUntil ? `保留至 ${new Date(asset.retentionUntil).toLocaleString()}` : "当前可用"}))} onChange={setSelected} /> : <p>暂无可用图片，可先上传到素材库或返回上传本机照片。</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page===1||loading||busy} onClick={()=>setPage(value=>value-1)}>上一页</Button><span className="text-xs">第 {page} 页</span><Button variant="outline" size="sm" disabled={!more||loading||busy} onClick={()=>setPage(value=>value+1)}>下一页</Button></div>
    </div>
    <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={close}>取消</Button>{error&&<Button variant="outline" disabled={busy} onClick={()=>setAttempt(value=>value+1)}>重新加载</Button>}<Button disabled={!selected||loading||busy} onClick={selectImage}>{busy?"正在导入…":"使用这张图片"}</Button></div>
  </dialog>;
}
