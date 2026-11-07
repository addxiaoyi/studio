"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { FashionTryOn } from "@/components/fashion-try-on";

type Outfit = { id: string; category: string; keywords: string; thumb: string; image: string };

const labels: Record<string, string> = {
  春: "春季", 夏: "夏季", 秋: "秋季", 冬: "冬季",
  ランジェリー: "内衣", パーティ: "派对", 水着: "泳装", セクシー: "性感",
};
const PAGE_SIZE = 48;

export function LegacyFashionGallery() {
  const [items, setItems] = useState<Outfit[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Outfit | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!selected) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    const closeButton = dialog?.querySelector<HTMLButtonElement>("button");
    closeButton?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelected(null);
      } else if (event.key === "Tab" && dialog) {
        const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last && first) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [selected]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/fashion-gallery/catalog.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Catalog unavailable");
        return response.json() as Promise<Outfit[]>;
      })
      .then((catalog) => { setItems(catalog); setStatus("ready"); })
      .catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, []);

  const categories = useMemo(() => [...new Set(items.map((item) => item.category))], [items]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => (!category || item.category === category) &&
      (!term || `${item.id} ${item.keywords} ${item.category} ${labels[item.category] ?? ""}`.toLowerCase().includes(term)));
  }, [items, query, category]);

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <div><h1 className="text-xl font-semibold">女装图集</h1><p className="mt-1 text-sm text-muted-foreground">穿搭参考 · {items.length} 套</p></div>
          <label className="relative block w-full sm:w-72"><span className="sr-only">搜索穿搭</span><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} placeholder="搜索编号或英文关键词" className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm" /></label>
        </div>
        <div className="flex flex-wrap gap-2 py-4" aria-label="穿搭分类">
          <button type="button" aria-pressed={!category} onClick={() => { setCategory(""); setLimit(PAGE_SIZE); }} className={`rounded-md border px-3 py-2 text-sm ${!category ? "border-foreground bg-foreground text-background" : "border-border"}`}>全部</button>
          {categories.map((name) => <button type="button" key={name} aria-pressed={category === name} onClick={() => { setCategory(name); setLimit(PAGE_SIZE); }} className={`rounded-md border px-3 py-2 text-sm ${category === name ? "border-foreground bg-foreground text-background" : "border-border"}`}>{labels[name] ?? name}</button>)}
        </div>
        {status === "loading" && <p role="status" className="py-12 text-sm text-muted-foreground">正在加载图集…</p>}
        {status === "error" && <p role="alert" className="py-12 text-sm text-destructive">图集加载失败，请刷新后重试。</p>}
        {status === "ready" && filtered.length === 0 && <p className="py-12 text-sm text-muted-foreground">没有找到符合条件的穿搭。</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {filtered.slice(0, limit).map((item) => <button type="button" key={item.id} onClick={() => setSelected(item)} className="group min-w-0 overflow-hidden rounded-md border border-border text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><img loading="lazy" src={`/fashion-gallery/${item.thumb}`} alt={`${labels[item.category] ?? item.category}穿搭 ${item.id}`} className="aspect-[2/3] w-full object-cover" /><span className="block truncate px-2 py-2 text-xs text-muted-foreground">{item.id} · {labels[item.category] ?? item.category}</span></button>)}
        </div>
        {limit < filtered.length && <div className="py-6 text-center"><button type="button" className="rounded-md border border-border px-4 py-2 text-sm" onClick={() => setLimit((current) => current + PAGE_SIZE)}>加载更多</button></div>}
        <p className="py-5 text-xs text-muted-foreground">图集来源：衣装集 · MIT 代码许可</p>
      </div>
      {selected && createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setSelected(null)}><div role="dialog" aria-modal="true" aria-label={`穿搭 ${selected.id}`} className="relative max-h-full max-w-3xl overflow-auto rounded-md bg-background p-3" onClick={(event) => event.stopPropagation()}><button type="button" aria-label="关闭预览" onClick={() => setSelected(null)} className="absolute right-5 top-5 rounded-md bg-background p-2"><X className="size-5" /></button><img src={`/fashion-gallery/${selected.image}`} alt={`穿搭 ${selected.id}`} className="max-h-[75vh] max-w-full object-contain" /><FashionTryOn outfit={selected} /><p className="mt-2 text-sm">{selected.id} · {selected.keywords}</p></div></div>, document.body)}
    </main>
  );
}
