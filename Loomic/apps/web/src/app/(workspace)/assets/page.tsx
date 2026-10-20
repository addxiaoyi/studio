"use client";

import { Check, Download, Images, RefreshCw, Search, Share2, Trash2, Undo2, Video, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { GradualBlur } from "@/components/gradual-blur";
import { createProject, deleteGeneratedAssets, fetchGeneratedAssets, publishAsset, unpublishAsset, restoreGeneratedAsset, type GeneratedAsset } from "@/lib/server-api";

const PREVIEW_CONCURRENCY = 4;
const PREVIEW_TIMEOUT_MS = 12_000;
const ASSETS_PER_PAGE = 12;

function assetDisplayName(asset: GeneratedAsset): string {
  const title = asset.title?.trim();
  if (title) return title;
  const prompt = asset.prompt?.trim().replace(/\s+/g, " ");
  if (prompt) return prompt.length > 30 ? `${prompt.slice(0, 30)}…` : prompt;
  const type = asset.mediaType === "video" ? "视频" : "图片";
  const date = new Date(asset.createdAt).toLocaleDateString("zh-CN");
  return `${type} · ${date} · ${asset.id.slice(0, 6)}`;
}

function remainingRetentionDays(asset: GeneratedAsset): number | null {
  const deadline = asset.retentionState === "soft_deleted" ? asset.purgeAfter : asset.retentionUntil;
  if (!deadline) return null;
  const remaining = new Date(deadline).getTime() - Date.now();
  if (!Number.isFinite(remaining)) return null;
  return Math.max(0, Math.ceil(remaining / 86_400_000));
}

type PreviewEntry = readonly [id: string, url: string, error: string];

async function loadPreviewEntries(
  assets: GeneratedAsset[],
  token: string,
  signal: AbortSignal,
  onObjectUrl: (url: string) => void,
  onEntry: (entry: PreviewEntry) => void,
) {
  let cursor = 0;

  async function worker() {
    while (!signal.aborted) {
      const index = cursor++;
      const asset = assets[index];
      if (!asset) return;
      if (!asset.url) {
        onEntry([asset.id, "", "缺少文件地址"]);
        continue;
      }

      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      signal.addEventListener("abort", abortRequest, { once: true });
      const timeout = window.setTimeout(abortRequest, PREVIEW_TIMEOUT_MS);
      try {
        const requestUrl = `${asset.url}?preview=1`;
        const response = await fetch(requestUrl, {
          headers: { Authorization: `Bearer ${token}` },
          signal: requestController.signal,
        });
        if (!response.ok) {
          onEntry([asset.id, "", `文件加载失败（${response.status}）`]);
          continue;
        }
        const mimeType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
        const expectedType = asset.mediaType === "video" ? "video/" : "image/";
        if (!mimeType.startsWith(expectedType)) {
          onEntry([asset.id, "", "文件类型与资产记录不一致"]);
          continue;
        }
        const objectUrl = URL.createObjectURL(await response.blob());
        onObjectUrl(objectUrl);
        onEntry([asset.id, objectUrl, ""]);
      } catch (error) {
        if (signal.aborted) return;
        const timedOut = requestController.signal.aborted;
        onEntry([asset.id, "", timedOut ? "预览加载超时，请重试" : "网络异常，无法加载预览"]);
      } finally {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", abortRequest);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PREVIEW_CONCURRENCY, assets.length) }, () => worker()),
  );
}

export default function AssetsPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: ASSETS_PER_PAGE, total: 0, hasMore: false });
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorAction, setErrorAction] = useState<
    | { type: "load" }
    | { type: "editor"; assetId: string }
    | { type: "publish" | "unpublish" | "restore"; assetId: string }
    | null
  >(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);

  const unpublish = useCallback(async (asset: GeneratedAsset) => {
    if (!session?.access_token || !asset.published || publishingId) return;
    if (!window.confirm("取消公开后，其他用户将无法在作品库中看到该作品。继续吗？")) return;
    setPublishingId(asset.id);
    setPublishNotice("");
    setError("");
    setErrorAction(null);
    try {
      await unpublishAsset(session.access_token, asset.id);
      setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, published: false } : item));
      setPublishNotice("作品已取消公开");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取消公开失败");
      setErrorAction({ type: "unpublish", assetId: asset.id });
    } finally {
      setPublishingId(null);
    }
  }, [publishingId, session?.access_token]);

  const publish = useCallback(async (asset: GeneratedAsset) => {
    if (!session?.access_token || asset.published || publishingId) return;
    const displayName = assetDisplayName(asset);
    if (!window.confirm(`确认公开“${displayName}”？图片、标题、作者和生成信息会展示在公共作品库。`)) return;
    setPublishingId(asset.id);
    setPublishNotice("");
    setError("");
    setErrorAction(null);
    try {
      const details = {
        title: displayName,
        ...(asset.description ? { description: asset.description } : {}),
      };
      await publishAsset(session.access_token, asset.id, details);
      setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, published: true } : item));
      setPublishNotice("作品已公开到作品库");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "公开作品失败");
      setErrorAction({ type: "publish", assetId: asset.id });
    } finally {
      setPublishingId(null);
    }
  }, [publishingId, session?.access_token]);

  const openEditor = useCallback(async (asset: GeneratedAsset) => {
    if (!session?.access_token || !asset.url) return;
    setOpeningId(asset.id);
    try {
      const { project } = await createProject(
        session.access_token,
        { name: assetDisplayName(asset) },
        { idempotencyKey: `asset-editor:${asset.id}` },
      );
      router.push(`/canvas?id=${project.primaryCanvas.id}&assetId=${encodeURIComponent(asset.id)}&mediaType=${asset.mediaType}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法打开图片编辑器");
      setErrorAction({ type: "editor", assetId: asset.id });
    } finally {
      setOpeningId(null);
    }
  }, [router, session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError("");
    setErrorAction(null);
    try { const options = filter === "all" ? { page, pageSize: ASSETS_PER_PAGE, query, includeDeleted: showRecovery } : { page, pageSize: ASSETS_PER_PAGE, query, includeDeleted: showRecovery, mediaType: filter }; const response = await fetchGeneratedAssets(session.access_token, options); setAssets(response.assets); setPagination(response.pagination); setSelectedIds(new Set()); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "资产加载失败");
      setErrorAction({ type: "load" });
    }
    finally { setLoading(false); }
  }, [session?.access_token, page, query, filter, showRecovery]);

  const restore = useCallback(async (asset: GeneratedAsset) => {
    if (!session?.access_token || asset.retentionState !== "soft_deleted") return;
    setError("");
    setErrorAction(null);
    try {
      await restoreGeneratedAsset(session.access_token, asset.id);
      setPublishNotice("资产已恢复，可在普通资产列表中继续使用。");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复资产失败，请重试。");
      setErrorAction({ type: "restore", assetId: asset.id });
    }
  }, [load, session?.access_token]);

  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer); }, [load]);
  useEffect(() => {
    const token = session?.access_token;
    if (!token || assets.length === 0) {
      setPreviewUrls({});
      setPreviewErrors({});
      return;
    }

    let cancelled = false;
    const objectUrls: string[] = [];
    const controller = new AbortController();
    setPreviewUrls({});
    setPreviewErrors({});

    void loadPreviewEntries(
      assets,
      token,
      controller.signal,
      (url) => objectUrls.push(url),
      ([id, url, entryError]) => {
        if (cancelled) return;
        if (url) setPreviewUrls((current) => ({ ...current, [id]: url }));
        if (entryError) setPreviewErrors((current) => ({ ...current, [id]: entryError }));
      },
    );

    return () => {
      cancelled = true;
      controller.abort();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [assets, previewRetry, session?.access_token]);

  const visible = filter === "all" ? assets : assets.filter((asset) => asset.mediaType === filter);
  const toggleSelected = (id: string) => setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectAll = () => setSelectedIds(selectedIds.size === visible.length ? new Set() : new Set(visible.map((asset) => asset.id)));
  const removeSelected = async () => {
    if (!session?.access_token || selectedIds.size === 0 || !window.confirm(`将 ${selectedIds.size} 项移到恢复区？资产将在 7 天后清理，你可以在此之前恢复。`)) return;
    setLoading(true);
    setError("");
    try {
      const result = await deleteGeneratedAssets(session.access_token, [...selectedIds]);
      if (result.deletedCount === 0) throw new Error("所选资产没有变更。请刷新列表后重试。");
      setPublishNotice(`${result.deletedCount} 项资产已移到恢复区，可在 7 天内恢复。`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移动资产到恢复区失败，请重试。");
      setLoading(false);
    }
  };
  const restoreSelected = async () => {
    if (!session?.access_token || selectedIds.size === 0) return;
    setError("");
    try {
      const recoverable = assets.filter((asset) => selectedIds.has(asset.id) && asset.retentionState === "soft_deleted");
      await Promise.all(recoverable.map((asset) => restoreGeneratedAsset(session.access_token!, asset.id)));
      setPublishNotice(`${recoverable.length} 项资产已恢复。`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批量恢复失败。未成功的项目仍保留在恢复区。");
    }
  };

  const retryErrorAction = () => {
    if (errorAction?.type === "editor") {
      const asset = assets.find((item) => item.id === errorAction.assetId);
      if (asset) void openEditor(asset);
      return;
    }
    if (errorAction?.type === "publish" || errorAction?.type === "unpublish" || errorAction?.type === "restore") {
      const asset = assets.find((item) => item.id === errorAction.assetId);
      if (asset) {
        if (errorAction.type === "publish") void publish(asset);
        if (errorAction.type === "unpublish") void unpublish(asset);
        if (errorAction.type === "restore") void restore(asset);
      }
      return;
    }
    void load();
  };

  return <main data-assets-scroll aria-busy={loading} className="relative mx-auto max-h-[calc(100vh-4rem)] min-h-full max-w-7xl overflow-y-auto p-6 pb-24 md:p-10 md:pb-28">
    {!loading && !error && visible.length > 0 && <GradualBlur autoHide height="4rem" className="bottom-24 z-0" />}
    {showRecovery && <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs"><span>恢复区资产将在 7 天后清理</span><button type="button" onClick={() => void restoreSelected()} disabled={selectedIds.size === 0} className="rounded-md border px-2 py-1 disabled:opacity-40">恢复所选</button></div>}
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">图片与视频生成记录 · 保存 30 天</p><h1 className="mt-1 text-3xl font-semibold">我的资产</h1><p className="mt-2 text-sm text-muted-foreground">资产将在生成后 30 天自动清理，请及时下载或继续在画布中编辑。</p></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm disabled:opacity-50"><RefreshCw className="size-4" />刷新</button></header>
    <div className="mt-7 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <button type="button" onClick={() => { setShowRecovery((value) => !value); setPage(1); }} aria-pressed={showRecovery} className={`self-start rounded-lg border px-3 py-2 text-xs ${showRecovery ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground"}`}>{showRecovery ? "返回我的资产" : "查看恢复区"}</button>
      <div className="flex flex-wrap items-center gap-1" aria-label="资产类型">{(["all", "image", "video"] as const).map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => { setFilter(item); setPage(1); }} className={`rounded-lg px-4 py-2 text-sm ${filter === item ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}>{item === "all" ? "全部" : item === "image" ? "图片" : "视频"}</button>)}</div>
      <div className="relative block w-full max-w-sm"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索标题或提示词" aria-label="搜索资产标题或提示词" className="h-9 w-full rounded-lg border border-border/60 bg-background pl-9 pr-9 text-sm outline-none focus:border-foreground/40" />{query && <button type="button" onClick={() => { setQuery(""); setPage(1); }} aria-label="清除资产搜索" className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>}</div>
    </div>
    {!loading && visible.length > 0 && <div className="relative z-10 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs" role="region" aria-label="资产批量操作" aria-live="polite"><button type="button" onClick={selectAll} aria-pressed={selectedIds.size === visible.length} className="inline-flex items-center gap-1.5 font-medium">{selectedIds.size === visible.length ? <Check className="size-3.5" /> : null}全选本页</button><span className="text-muted-foreground">已选 {selectedIds.size} 项 · 当前页 {visible.length} 项 · 共 {pagination.total} 项</span>{selectedIds.size > 0 && <button type="button" onClick={() => void removeSelected()} disabled={loading} className="ml-auto inline-flex items-center gap-1.5 text-destructive disabled:opacity-50"><Trash2 className="size-3.5" />删除所选</button>}</div>}
    {loading && <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="status" aria-label="正在加载资产">
      {Array.from({ length: 8 }, (_, index) => <div key={index} className="overflow-hidden rounded-lg border border-border/60 bg-card" aria-hidden="true">
        <div className="aspect-square animate-pulse bg-muted-foreground/10" />
        <div className="space-y-2 p-4"><div className="h-3 w-3/5 animate-pulse rounded bg-muted-foreground/10" /><div className="h-2.5 w-2/5 animate-pulse rounded bg-muted-foreground/10" /><div className="h-8 w-20 animate-pulse rounded-md bg-muted-foreground/10" /></div>
      </div>)}
    </div>}
    {!loading && error && <div role="alert" className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive"><span>{error}</span><button type="button" onClick={retryErrorAction} className="inline-flex h-9 items-center gap-2 rounded-md border border-destructive/30 px-3 text-xs font-medium hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><RefreshCw className="size-3.5" />{errorAction?.type === "editor" ? "重试打开画布" : errorAction?.type === "publish" ? "重试公开作品" : errorAction?.type === "unpublish" ? "重试取消公开" : errorAction?.type === "restore" ? "重试恢复" : "重试加载"}</button></div>}
    {!loading && !error && visible.length === 0 && <div className="mt-8 flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed text-center"><Images className="size-10 text-muted-foreground/40" /><h2 className="mt-4 font-medium">还没有资产</h2><p className="mt-1 text-sm text-muted-foreground">从图片或视频创作页开始生成。</p></div>}
    {publishNotice && <p role="status" className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{publishNotice}，可在左侧“作品库”查看。</p>}
    {!loading && !error && visible.length > 0 && (
      <div className="relative z-10 mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((asset) => {
          const previewUrl = previewUrls[asset.id];
          const previewError = previewErrors[asset.id];
          const editable = Boolean(asset.url);
          const displayName = assetDisplayName(asset);
          const daysLeft = remainingRetentionDays(asset);

          return (
            <article key={asset.id} className="relative overflow-hidden rounded-lg border bg-card">
              <button
                type="button"
                aria-label={`选择 ${displayName}`}
                aria-pressed={selectedIds.has(asset.id)}
                onClick={() => toggleSelected(asset.id)}
                className={`absolute left-3 top-3 z-10 flex size-8 items-center justify-center rounded-md border bg-background/90 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${selectedIds.has(asset.id) ? "border-foreground bg-foreground text-background" : "border-border/60"}`}
              >
                {selectedIds.has(asset.id) ? <Check className="size-4" /> : null}
              </button>
              <div className="relative flex aspect-square items-center justify-center bg-muted" aria-busy={!previewUrl && !previewError}>
                {previewUrl ? asset.mediaType === "video" ? (
                  <video src={previewUrl} controls playsInline preload="metadata" aria-label={`${displayName} 视频预览`} className="h-full w-full object-contain" />
                ) : (
                  <button type="button" onClick={() => void openEditor(asset)} disabled={!editable} aria-label={`在画布中编辑 ${displayName}`} className="group h-full w-full disabled:cursor-not-allowed">
                    <img src={previewUrl} alt={displayName} loading="lazy" className="h-full w-full object-cover transition-opacity group-hover:opacity-85" />
                  </button>
                ) : previewError ? (
                  <div className="flex flex-col items-center gap-2 px-5 text-center">
                    {asset.mediaType === "video" ? <Video className="size-9 text-muted-foreground/40" /> : <Images className="size-9 text-muted-foreground/40" />}
                    <span className="text-xs text-muted-foreground">{previewError}</span>
                  </div>
                ) : (
                  <div className="absolute inset-0 animate-pulse bg-muted-foreground/10" role="status" aria-label="正在加载预览"><span className="sr-only">正在加载预览…</span></div>
                )}
              </div>
              <div className="relative z-10 flex items-start gap-3 bg-card p-4">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-medium">{displayName}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{openingId === asset.id ? "正在打开编辑器..." : `${asset.mediaType === "video" ? "视频" : "图片"} · ${new Date(asset.createdAt).toLocaleDateString("zh-CN")}`}</p>
                  {daysLeft !== null ? <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{asset.retentionState === "soft_deleted" ? "恢复期剩余" : "保留期剩余"} {daysLeft} 天</p> : null}
                  {editable && <button type="button" onClick={() => void openEditor(asset)} disabled={openingId === asset.id} className="mt-2 text-xs font-medium text-foreground underline underline-offset-2 disabled:opacity-50">{openingId === asset.id ? "正在打开…" : "在画布中编辑"}</button>}
                </div>
                {previewUrl ? <a href={previewUrl} download aria-label={`下载 ${displayName}`} className="flex size-8 shrink-0 items-center justify-center rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Download className="size-4" /></a> : previewError ? <button type="button" onClick={() => setPreviewRetry((value) => value + 1)} aria-label={`重试加载 ${displayName}`} className="shrink-0 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">重试预览</button> : <span className="size-8 shrink-0" aria-hidden="true" />}
              </div>
              <div className="relative z-10 flex items-center justify-between border-t border-border/50 bg-card px-4 py-3">
                <span className="text-[11px] text-muted-foreground">{asset.retentionState === "soft_deleted" ? "恢复区资产" : asset.published ? "已公开到作品库" : "仅自己可见"}</span>
                {asset.retentionState === "soft_deleted" ? (
                  <button type="button" onClick={() => void restore(asset)} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"><Undo2 className="size-3.5" />恢复</button>
                ) : asset.published ? (
                  <button type="button" onClick={() => void unpublish(asset)} disabled={publishingId === asset.id} className="min-h-8 rounded-md px-2 text-xs text-muted-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">{publishingId === asset.id ? "处理中…" : "取消公开"}</button>
                ) : (
                  <button type="button" onClick={() => void publish(asset)} disabled={publishingId === asset.id} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50">{publishingId === asset.id ? "发布中…" : <><Share2 className="size-3.5" />公开作品</>}</button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    )}
    {!loading && !error && pagination.total > 0 && <div className="relative z-10 mt-8 flex items-center justify-center gap-3"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">上一页</button><span className="text-xs text-muted-foreground">第 {pagination.page} 页 · 共 {pagination.total} 项</span><button type="button" disabled={!pagination.hasMore} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">下一页</button></div>}
  </main>;
}
