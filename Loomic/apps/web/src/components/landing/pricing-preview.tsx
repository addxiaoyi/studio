"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Image, RefreshCw, Video } from "lucide-react";
import type { OfficialModelPrice, OfficialModelPriceCatalog, OfficialPriceMediaType } from "@helstera/shared";
import { USD_CNY_RATE } from "@helstera/shared";
import { fetchImageModels, fetchVideoModels, type ImageModelInfo, type VideoModelInfo } from "@/lib/server-api";
import { fetchOfficialModelPrices } from "@/lib/model-pricing-api";
import { compareRuntimePrice, findRuntimePriceModel } from "@/lib/model-pricing";

type RuntimeModel = (ImageModelInfo | VideoModelInfo) & { mediaType: OfficialPriceMediaType };
type PriceRow = { model: RuntimeModel; officialCny: number; runtimeCny: number; savedPercent: number };
const MAX_ROWS = 12;

export function PricingPreview() {
  const [catalog, setCatalog] = useState<OfficialModelPriceCatalog | null>(null);
  const [models, setModels] = useState<RuntimeModel[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    void Promise.all([fetchOfficialModelPrices(), fetchImageModels(), fetchVideoModels()])
      .then(([prices, images, videos]) => {
        if (cancelled) return;
        setCatalog(prices);
        setModels([
          ...images.models.map((model) => ({ ...model, mediaType: "image" as const })),
          ...videos.models.map((model) => ({ ...model, mediaType: "video" as const })),
        ]);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [retry]);

  const rows = useMemo(() => buildRows(catalog, models), [catalog, models]);

  return (
    <section id="pricing" className="relative overflow-hidden border-y border-border/70 bg-muted/20 py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <header className="flex flex-col gap-5 border-b border-border/70 pb-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">MODEL PRICING</p>
            <h2 className="mt-3 text-3xl font-medium tracking-tight md:text-4xl">低于官方价格的模型</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground md:text-base">只展示当前可调用且 Helstera 低于官方最高 API 单价的模型，并说明每个模型的用途和计费单位。</p>
          </div>
          <Link href="/model-pricing/" className="inline-flex h-10 w-fit items-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted">
            查看完整价格表 <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </header>

        {error ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>模型价格暂时无法加载</p>
            <button type="button" onClick={() => setRetry((value) => value + 1)} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"><RefreshCw className="size-3.5" aria-hidden="true" />重试</button>
          </div>
        ) : models === null || catalog === null ? (
          <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">正在读取模型价格…</div>
        ) : rows.length === 0 ? (
          <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">当前没有低于官方价格的可调用模型</div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-lg border border-border bg-background">
            <div className="hidden grid-cols-[1.5fr_0.8fr_0.8fr_0.7fr] border-b border-border bg-muted/40 px-5 py-3 text-xs font-medium text-muted-foreground md:grid"><span>模型与用途</span><span>官方最高价</span><span>Helstera 价格</span><span>节省</span></div>
            <div className="divide-y divide-border/70">{rows.slice(0, MAX_ROWS).map((row) => <PriceRowView key={`${row.model.mediaType}:${row.model.id}`} row={row} />)}</div>
          </div>
        )}
        {rows.length > MAX_ROWS && <p className="mt-4 text-center text-xs text-muted-foreground">还有 {rows.length - MAX_ROWS} 个低于官方价格的模型，详见完整价格表。</p>}
      </div>
    </section>
  );
}

function buildRows(catalog: OfficialModelPriceCatalog | null, models: RuntimeModel[] | null): PriceRow[] {
  if (!catalog || !models) return [];
  return models.flatMap((model) => {
    const runtimeCny = model.providerPriceCny ?? model.creditCost;
    if (runtimeCny == null || model.billingUnit === "per_million_tokens") return [];
    const unit = model.billingUnit === "per_second" ? "per_second" : "per_image";
    const official = catalog.prices
      .filter((price) => price.mediaType === model.mediaType && price.unit === unit)
      .filter((price) => findRuntimePriceModel(price.modelId, price.mediaType, [model]) !== null)
      .sort((left, right) => right.officialMax - left.officialMax)[0];
    if (!official) return [];
    const comparison = compareRuntimePrice(runtimeCny, official.officialMax * (catalog.usdCnyRate || USD_CNY_RATE));
    if (comparison.relation !== "below") return [];
    return [{ model, officialCny: comparison.officialMaxCny, runtimeCny, savedPercent: Math.round(Math.abs(comparison.deltaCny) / comparison.officialMaxCny * 100) }];
  }).sort((left, right) => right.savedPercent - left.savedPercent || left.model.displayName.localeCompare(right.model.displayName));
}

function PriceRowView({ row }: { row: PriceRow }) {
  const Icon = row.model.mediaType === "image" ? Image : Video;
  const unit = row.model.billingUnit === "per_second" ? "秒" : "张";
  return (
    <article className="grid gap-3 px-5 py-4 md:grid-cols-[1.5fr_0.8fr_0.8fr_0.7fr] md:items-center">
      <div className="flex min-w-0 items-start gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><div className="min-w-0"><p className="font-medium">{row.model.displayName}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{row.model.description || "可用于 Helstera 创作工作流"}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{row.model.id} · 按{unit}计费</p></div></div>
      <div className="flex items-start justify-between gap-3 text-sm md:block"><div><span className="text-xs text-muted-foreground md:hidden">官方最高价</span><p className="tabular-nums">{formatCny(row.officialCny)} / {unit}</p>{isOpenAiTokenEstimate(row.model.id) && <p className="mt-1 max-w-56 text-[11px] leading-4 text-muted-foreground">OpenAI 官方 Token 计费换算估算，非固定按张价</p>}</div></div>
      <div className="flex items-baseline justify-between gap-3 text-sm md:block"><span className="text-xs text-muted-foreground md:hidden">Helstera</span><span className="font-medium tabular-nums">{formatCny(row.runtimeCny)} / {unit}</span></div>
      <p className="text-right text-sm font-medium text-emerald-700 md:text-left">低 {row.savedPercent}%</p>
    </article>
  );
}

function isOpenAiTokenEstimate(modelId: string) {
  return /^gpt-image-2(?:\.5)?(?:-|$)/i.test(modelId);
}

function formatCny(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value);
}
