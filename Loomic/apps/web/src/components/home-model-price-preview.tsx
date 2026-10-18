"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Clock3, Image, RefreshCw, Video } from "lucide-react";
import type { OfficialModelPrice, OfficialModelPriceCatalog, OfficialPriceMediaType } from "@helstera/shared";
import { USD_CNY_RATE } from "@helstera/shared";
import { fetchImageModels, fetchVideoModels, type ImageModelInfo, type VideoModelInfo } from "@/lib/server-api";
import { fetchOfficialModelPrices } from "@/lib/model-pricing-api";
import { compareRuntimePrice, findRuntimePriceModel } from "@/lib/model-pricing";

type MediaFilter = "all" | OfficialPriceMediaType;
type RuntimeModel = (ImageModelInfo | VideoModelInfo) & { mediaType: OfficialPriceMediaType };
type ModelPriceRow = {
  model: RuntimeModel;
  official: OfficialModelPrice;
  officialCny: number;
  runtimeCny: number;
  savedPercent: number;
};

const MEDIA_OPTIONS: Array<{ id: MediaFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
];

export function HomeModelPricePreview() {
  const [catalog, setCatalog] = useState<OfficialModelPriceCatalog | null>(null);
  const [models, setModels] = useState<RuntimeModel[] | null>(null);
  const [media, setMedia] = useState<MediaFilter>("all");
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
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);

  const matchedRows = useMemo(() => buildPriceRows(catalog, models), [catalog, models]);
  const rows = useMemo(
    () => matchedRows.filter((row) => media === "all" || row.model.mediaType === media),
    [matchedRows, media],
  );
  const automaticSources = catalog?.sources.filter((source) => source.automatic) ?? [];
  const unavailableCount = automaticSources.filter((source) => source.status === "failed").length;
  const lastSync = automaticSources
    .map((source) => source.lastSuccessAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  return (
    <section aria-labelledby="home-model-prices-title" className="my-10 w-full rounded-xl border border-border/70 bg-card/70 p-5 shadow-sm sm:my-12 sm:p-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">LIVE MODEL PRICES</p>
          <h2 id="home-model-prices-title" className="mt-2 text-xl font-medium tracking-tight">低于官方价格的可调用模型</h2>
          <p className="mt-1 text-sm text-muted-foreground">实时模型目录与官方价格逐项匹配，只展示 Helstera 当前价格较低的模型。</p>
        </div>
        <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-background p-1" aria-label="价格预览类型">
          {MEDIA_OPTIONS.map((option) => (
            <MediaButton key={option.id} selected={media === option.id} onClick={() => setMedia(option.id)}>{option.label}</MediaButton>
          ))}
        </div>
      </header>

      <div className="mt-5 hidden grid-cols-[minmax(220px,1.7fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_minmax(110px,0.6fr)_minmax(110px,0.7fr)] border-y border-border/60 py-2.5 text-[11px] font-medium text-muted-foreground sm:grid">
        <span>模型与用途</span><span>官方价</span><span>Helstera 实际价</span><span>价格差</span><span>匹配状态</span>
      </div>

      {error ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <span>实时模型或价格目录暂时无法加载</span>
          <button type="button" onClick={() => setRetry((value) => value + 1)} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <RefreshCw className="size-3.5" aria-hidden="true" />重试
          </button>
        </div>
      ) : !catalog || !models ? (
        <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">正在读取实时模型和价格…</div>
      ) : rows.length ? (
        <div className="divide-y divide-border/60">
          {rows.slice(0, 8).map((row) => <PricePreviewRow key={`${row.model.mediaType}:${row.model.id}`} row={row} />)}
        </div>
      ) : (
        <div className="grid min-h-40 place-items-center px-4 text-center text-sm text-muted-foreground">
          当前{media === "all" ? "可调用目录" : media === "image" ? "图片" : "视频"}中没有同时匹配官方价格且低于官方价的模型
        </div>
      )}

      <footer className="mt-4 flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="size-3.5" aria-hidden="true" />
          {lastSync
            ? `官方价格同步 ${formatDateTime(lastSync)}${unavailableCount ? ` · ${unavailableCount} 个来源不可达，沿用快照` : ""}`
            : unavailableCount ? "自动价格源不可达，当前使用官方快照" : "价格来源与核验时间见完整价格表"}
        </span>
        <Link href="/model-pricing/" className="inline-flex w-fit items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">
          查看全部可调用模型与价格来源 <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </footer>
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
        价格来自当前 Provider 配置；GPT Image 的单张参考价为官方 Token 单价换算估算，并非 OpenAI 固定按张报价。
      </p>
    </section>
  );
}

function buildPriceRows(catalog: OfficialModelPriceCatalog | null, models: RuntimeModel[] | null): ModelPriceRow[] {
  if (!catalog || !models) return [];
  const rows = models.flatMap((model) => {
    if (model.billingUnit === "per_million_tokens") return [];
    if ("availability" in model && model.availability === "unavailable") return [];
    const runtimeCny = model.providerPriceCny ?? model.creditCost;
    if (runtimeCny == null || !Number.isFinite(runtimeCny)) return [];

    const expectedUnit = model.billingUnit === "per_second" ? "per_second" : "per_image";
    const official = catalog.prices
      .filter((price) => price.mediaType === model.mediaType && price.unit === expectedUnit)
      .filter((price) => findRuntimePriceModel(price.modelId, model.mediaType, [runtimeCandidate(model)]) !== null)
      .sort((left, right) => right.officialMax - left.officialMax)[0];
    if (!official) return [];

    const officialCny = official.officialMax * (catalog.usdCnyRate || USD_CNY_RATE);
    const comparison = compareRuntimePrice(runtimeCny, officialCny);
    if (comparison.relation !== "below") return [];
    return [{
      model,
      official,
      officialCny,
      runtimeCny,
      savedPercent: Math.round(Math.abs(comparison.deltaCny) / officialCny * 100),
    }];
  });

  const unique = new Map<string, ModelPriceRow>();
  for (const row of rows) {
    const key = `${row.model.mediaType}:${row.model.id.trim().toLowerCase()}`;
    const current = unique.get(key);
    if (!current || row.officialCny > current.officialCny) unique.set(key, row);
  }
  return [...unique.values()].sort((left, right) =>
    left.model.mediaType.localeCompare(right.model.mediaType)
      || left.model.displayName.localeCompare(right.model.displayName),
  );
}

function runtimeCandidate(model: RuntimeModel) {
  return { id: model.id, displayName: model.displayName, mediaType: model.mediaType };
}

function MediaButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );
}

function PricePreviewRow({ row }: { row: ModelPriceRow }) {
  const MediaIcon = row.model.mediaType === "image" ? Image : Video;
  const unit = row.model.billingUnit === "per_second" ? "秒" : "张";
  const tokenEstimate = isOpenAiTokenEstimate(row.official);
  return (
    <article className="grid gap-3 py-4 text-sm sm:grid-cols-[minmax(220px,1.7fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_minmax(110px,0.6fr)_minmax(110px,0.7fr)] sm:items-center">
      <div className="flex min-w-0 items-start gap-2 pr-2">
        <MediaIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium leading-5">{row.model.displayName}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{row.model.description || "可用于当前创作工作流"}</p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{row.model.id} · {row.model.mediaType === "image" ? "图片" : "视频"} · 按{unit}计费</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:block">
        <span className="text-xs text-muted-foreground sm:hidden">官方价</span>
        <div><p className="tabular-nums">{formatCny(row.officialCny)} / {unit}</p>{tokenEstimate && <p className="mt-1 max-w-56 text-[11px] leading-4 text-muted-foreground">OpenAI 官方 Token 计费换算估算，非固定按张价</p>}</div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:block"><span className="text-xs text-muted-foreground sm:hidden">Helstera 实际价</span><p className="font-medium tabular-nums">{formatCny(row.runtimeCny)} / {unit}</p></div>
      <div className="grid grid-cols-2 gap-3 sm:block"><span className="text-xs text-muted-foreground sm:hidden">低于官方</span><p className="font-medium text-emerald-700">低 {row.savedPercent}%</p></div>
      <p className="hidden text-xs text-muted-foreground sm:block">{"availability" in row.model && row.model.availability === "unverified" ? "待验证" : "ID 精确匹配"}</p>
    </article>
  );
}

function isOpenAiTokenEstimate(price: OfficialModelPrice) {
  return price.sourceLabel.includes("Token 价格折算")
    || price.sourceId.startsWith("openai-gpt-image-2-")
    || price.sourceId === "openai-gpt-image-2-estimate";
}

function formatCny(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
