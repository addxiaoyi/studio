"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, FileImage, FileVideo, Image as ImageIcon, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { deleteAdminAsset, fetchAdminAssets, updateAdminAsset } from "@/lib/server-api";

type Asset = Awaited<ReturnType<typeof fetchAdminAssets>>["data"][number] & { description?: string | null; object_path?: string | null };
type AssetStatus = "active" | "deleted";
const PAGE_SIZE = 20;

function dateText(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
function assetType(asset: Asset) {
  if (asset.media_type === "video" || asset.mime_type.startsWith("video/")) return "Video";
  if (asset.media_type === "image" || asset.mime_type.startsWith("image/")) return "Image";
  return asset.media_type || "Other";
}
function Summary({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return <div className="rounded-2xl border border-border/40 bg-card/60 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{hint}</p></div>;
}

export default function AdminImagesPage() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [rows, setRows] = useState<Asset[]>([]);
  const [status, setStatus] = useState<AssetStatus>("active");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try { setRows((await fetchAdminAssets(token, { status, page, pageSize: PAGE_SIZE })).data); setSelected([]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Asset loading failed"); }
    finally { setLoading(false); }
  }, [page, status, token]);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((asset) => [asset.id, asset.title, asset.description, asset.mime_type, asset.media_type, asset.object_path].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [query, rows]);
  const allSelected = visible.length > 0 && visible.every((asset) => selected.includes(asset.id));
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAll = () => setSelected((current) => allSelected ? current.filter((id) => !visible.some((asset) => asset.id === id)) : Array.from(new Set([...current, ...visible.map((asset) => asset.id)])));

  async function remove(ids: string[]) {
    if (!token || status !== "active" || !ids.length || !window.confirm(`Delete ${ids.length} selected asset(s)?`)) return;
    setBusy(true); setNotice(null); setError(null);
    try {
      const failed: string[] = [];
      for (const id of ids) { try { await deleteAdminAsset(token, id); } catch { failed.push(id); } }
      setNotice(failed.length ? `Deleted ${ids.length - failed.length}; ${failed.length} failed.` : `Deleted ${ids.length} asset(s).`);
      await load();
    } finally { setBusy(false); }
  }
  async function edit(asset: Asset) {
    if (!token || status !== "active") return;
    const title = window.prompt("Asset title", asset.title ?? ""); if (title === null) return;
    const description = window.prompt("Asset description", asset.description ?? ""); if (description === null) return;
    setBusy(true);
    try { await updateAdminAsset(token, asset.id, { title, description: description ?? "" }); setNotice("Asset metadata saved."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Asset update failed"); }
    finally { setBusy(false); }
  }

  return <section className="space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">Asset operations</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Asset audit</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Review lifecycle, ownership, storage paths, and deletion risk from the existing admin asset API.</p></div><button type="button" onClick={() => void load()} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</button></header>
    {error && <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}{notice && <div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-700">{notice}</div>}
    <div className="grid gap-3 sm:grid-cols-3"><Summary label="Current page" value={rows.length} hint={`Page ${page} · ${PAGE_SIZE} per page`} /><Summary label="Selected" value={selected.length} hint={selected.length ? "Ready for bulk action" : "Select assets to act"} /><Summary label="Lifecycle" value={status === "active" ? "Active" : "Deleted"} hint="Filtered by server status" /></div>
    <section className="overflow-hidden rounded-2xl border border-border/40 bg-card/50"><div className="flex flex-wrap items-center gap-3 border-b border-border/40 p-4"><div className="relative min-w-64 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, ID, MIME, or path" className="h-10 w-full rounded-xl border border-border/50 bg-background pl-10 pr-3 text-sm outline-none focus:border-foreground/40" /></div><div className="flex rounded-xl border border-border/50 p-1 text-xs">{(["active", "deleted"] as const).map((value) => <button key={value} type="button" onClick={() => { setStatus(value); setPage(1); setSelected([]); }} className={`rounded-lg px-3 py-2 ${status === value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}>{value === "active" ? "Active" : "Deleted"}</button>)}</div>{status === "active" && <button type="button" onClick={() => void remove(selected)} disabled={!selected.length || busy} className="inline-flex items-center gap-2 rounded-xl border border-destructive/30 px-3 py-2 text-xs text-destructive disabled:opacity-40"><Trash2 className="size-3.5" />Bulk delete</button>}</div>
      {loading ? <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3, 4, 5, 6].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl bg-muted/60" />)}</div> : !visible.length ? <div className="p-14 text-center"><ImageIcon className="mx-auto size-8 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">No matching assets</p><p className="mt-1 text-xs text-muted-foreground">Adjust the search or lifecycle filter.</p></div> : <><div className="flex items-center justify-between border-b border-border/30 px-4 py-3 text-xs text-muted-foreground"><button type="button" onClick={toggleAll} className="inline-flex items-center gap-2 hover:text-foreground"><span className={`flex size-4 items-center justify-center rounded border ${allSelected ? "border-foreground bg-foreground text-background" : "border-border"}`}>{allSelected && <Check className="size-3" />}</span>Select visible</button><span>{visible.length} / {rows.length}</span></div><div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">{visible.map((asset) => { const chosen = selected.includes(asset.id); const label = assetType(asset); return <article key={asset.id} className={`rounded-xl border p-4 ${chosen ? "border-foreground/50 bg-muted/40" : "border-border/40 bg-background/30"}`}><div className="flex items-start gap-3"><button type="button" onClick={() => toggle(asset.id)} aria-label={`Select ${asset.title || asset.id}`} className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${chosen ? "border-foreground bg-foreground text-background" : "border-border/50 text-transparent"}`}><Check className="size-4" /></button><div className="flex min-w-0 flex-1 items-center gap-2"><span className="rounded-lg bg-muted p-2">{label === "Video" ? <FileVideo className="size-4" /> : <FileImage className="size-4" />}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{asset.title || "Untitled asset"}</p><p className="truncate text-[11px] text-muted-foreground">{label} · {asset.mime_type || "Unknown type"}</p></div></div><button type="button" onClick={() => setDetail(asset)} className="rounded-lg p-1.5 text-xs text-muted-foreground hover:bg-muted">Details</button></div><div className="mt-4 space-y-2 text-xs text-muted-foreground"><p className="truncate" title={asset.object_path ?? undefined}>{asset.object_path || "No storage path"}</p><p>Created by {asset.created_by || "Unknown"}</p><p>{dateText(asset.created_at)}</p></div>{status === "active" && <div className="mt-4 flex gap-2 border-t border-border/30 pt-3"><button type="button" onClick={() => void edit(asset)} disabled={busy} className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">Edit metadata</button><button type="button" onClick={() => void remove([asset.id])} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs text-destructive hover:bg-destructive/5 disabled:opacity-50">Delete</button></div>}</article>; })}</div></>}</section>
    <footer className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Page {page}</span><div className="flex gap-2"><button type="button" disabled={page === 1 || loading} onClick={() => setPage((current) => current - 1)} className="inline-flex items-center gap-1 rounded-lg border border-border/50 px-3 py-2 text-xs disabled:opacity-40"><ChevronLeft className="size-3.5" />Previous</button><button type="button" disabled={loading || rows.length < PAGE_SIZE} onClick={() => setPage((current) => current + 1)} className="inline-flex items-center gap-1 rounded-lg border border-border/50 px-3 py-2 text-xs disabled:opacity-40">Next<ChevronRight className="size-3.5" /></button></div></footer>
    {detail && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" role="dialog" aria-modal="true" onClick={() => setDetail(null)}><div className="w-full max-w-xl rounded-2xl border border-border/50 bg-background p-5 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">Asset detail</p><h2 className="mt-1 text-lg font-semibold">{detail.title || "Untitled asset"}</h2></div><button type="button" onClick={() => setDetail(null)} aria-label="Close details" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X className="size-4" /></button></div><dl className="mt-5 grid gap-3 sm:grid-cols-2">{Object.entries({ ID: detail.id, Type: `${assetType(detail)} · ${detail.mime_type}`, Owner: detail.created_by, Created: dateText(detail.created_at), Deleted: dateText(detail.deleted_at), Path: detail.object_path || "Not recorded" }).map(([key, value]) => <div key={key} className="rounded-xl bg-muted/40 p-3"><dt className="text-[11px] text-muted-foreground">{key}</dt><dd className="mt-1 break-all text-sm">{value}</dd></div>)}</dl><p className="mt-4 text-xs leading-5 text-muted-foreground">The current admin API does not return a preview URL, so this panel does not invent one.</p></div></div>}
  </section>;
}
