"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, Clock3, ExternalLink, Image, LogIn, RefreshCw, Search, Video, WalletCards } from "lucide-react";
import type { OfficialModelPrice, OfficialModelPriceCatalog, OfficialPriceMediaType, WorkspaceModelPrice } from "@helstera/shared";
import { USD_CNY_RATE } from "@helstera/shared";
import { PricingNav } from "@/app/pricing/components/pricing-nav";
import { fetchImageModels, fetchVideoModels } from "@/lib/server-api";
import { fetchOfficialModelPrices, fetchWorkspaceModelPrices } from "@/lib/model-pricing-api";
import { compareRuntimePrice, findRuntimePriceModel } from "@/lib/model-pricing";
import type { ImageModelInfo, VideoModelInfo } from "@/lib/server-api";

type MediaFilter = "all" | OfficialPriceMediaType;
type ListedModel = {
  id: string;
  displayName: string;
  provider: string;
  mediaType: OfficialPriceMediaType;
  billingUnit?: "per_generation" | "per_second" | "per_million_tokens";
  priceCny?: number;
  inputPriceCny?: number;
  outputPriceCny?: number;
  status: string;
};

const MEDIA_FILTERS: Array<{ id: MediaFilter; label: string }> = [
  { id: "all", label: "全部模型" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
];

export default function ModelPricingPage() {
  const [catalog, setCatalog] = useState<OfficialModelPriceCatalog | null>(null);
  const [media, setMedia] = useState<MediaFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [workspaceModels, setWorkspaceModels] = useState<WorkspaceModelPrice[] | null>(null);
  const [workspaceError, setWorkspaceError] = useState<"unauthorized" | "unavailable" | null>(null);
  const [workspaceReload, setWorkspaceReload] = useState(0);
  const [models, setModels] = useState<ListedModel[] | null>(null);
  const [modelCatalogError, setModelCatalogError] = useState(false);
  const [modelCatalogReload, setModelCatalogReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchOfficialModelPrices()
      .then((result) => {
        if (!cancelled) setCatalog(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "价格数据暂时无法加载");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    setWorkspaceModels(null);
    setWorkspaceError(null);
    void fetchWorkspaceModelPrices()
      .then((result) => {
        if (cancelled) return;
        if (!result.authenticated) {
          setWorkspaceError("unauthorized");
          return;
        }
        setWorkspaceModels(result.models);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setWorkspaceError("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceReload]);

  useEffect(() => {
    let cancelled = false;
    setModels(null);
    setModelCatalogError(false);
    void Promise.all([fetchImageModels(), fetchVideoModels()])
      .then(([images, videos]) => {
        if (cancelled) return;
        setModels(dedupeListedModels([
          ...images.models.map((model) => toListedModel(model, "image", "可选")),
          ...(images.unavailableModels ?? []).map((model) => toListedModel(model, "image", "暂不可用")),
          ...videos.models.map((model) => toListedModel(model, "video", "可选")),
          ...(videos.unavailableModels ?? []).map((model) => toListedModel(model, "video", "暂不可用")),
        ]));
      })
      .catch(() => {
        if (!cancelled) setModelCatalogError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [modelCatalogReload]);

  const rows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (catalog?.prices ?? []).filter((price) => {
      if (media !== "all" && price.mediaType !== media) return false;
      if (!search) return true;
      return `${price.modelName} ${price.modelId} ${price.variant}`.toLowerCase().includes(search);
    });
  }, [catalog?.prices, media, query]);
  const comparisonModels = useMemo(
    () => mergeListedModels(models, workspaceModels),
    [models, workspaceModels],
  );
  const comparisonRows = useMemo(
    () => buildComparisonRows(comparisonModels, catalog?.prices ?? [], media, query),
    [comparisonModels, catalog?.prices, media, query],
  );

  const automaticSources = catalog?.sources.filter((source) => source.automatic) ?? [];
  const latestSuccess = automaticSources
    .map((source) => source.lastSuccessAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
  const unavailableSources = automaticSources.filter((source) => source.status === "failed").length;
  const workspaceModelCount = new Set((workspaceModels ?? []).map((item) => item.modelId)).size;

  function retryLoad() {
    setReload((value) => value + 1);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PricingNav />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-24 sm:px-6 sm:pt-28">
        <header className="flex flex-col gap-8 border-b border-border/70 pb-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">PRICE TRANSPARENCY</p>
            <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">模型价格对比</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              这里只列有可核验官方定价来源的模型，不等同于全部可调用模型。官方只显示最高人民币单价。
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2"><Check className="size-4 text-emerald-700" />官方来源直链</span>
            <span className="inline-flex items-center gap-2"><WalletCards className="size-4" />所有模型共用余额</span>
            <span className="inline-flex items-center gap-2"><Clock3 className="size-4" />每日自动核验</span>
          </div>
        </header>

        <section className="mt-6 grid gap-3 border-b border-border/70 pb-6 text-sm sm:grid-cols-3">
          <SourceSummary label="官方价格记录" value={`${catalog?.prices.length ?? 0} 条`} />
          <SourceSummary label="最近成功同步" value={latestSuccess ? formatDateTime(latestSuccess) : "等待首次同步"} />
          <SourceSummary
            label="来源状态"
            value={unavailableSources ? `${unavailableSources} 个来源暂不可达，保留上次价格` : loading ? "读取中" : "正常"}
          />
        </section>

        <section aria-labelledby="official-prices-title" className="mt-8">
          <header className="border-b border-border/70 pb-3">
            <h2 id="official-prices-title" className="text-xl font-medium">官方价格对比</h2>
            <p className="mt-1 text-sm text-muted-foreground">只显示官方最高 API 单价、核验状态和来源链接。</p>
          </header>
        </section>

        <section aria-label="模型价格筛选" className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-card p-1" aria-label="媒体类型">
            {MEDIA_FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={media === option.id}
                onClick={() => setMedia(option.id)}
                className={`rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${media === option.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_190px] lg:w-[470px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索模型或 Provider"
                aria-label="搜索模型或 Provider"
                className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-transparent focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
        </section>

        <section className="mt-8" aria-label="官方模型价格列表" aria-busy={loading || comparisonModels === null}>
          {error ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-4 border-y border-border/70 text-center">
              <p className="text-sm text-muted-foreground">价格目录当前无法连接。</p>
              <button type="button" onClick={retryLoad} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <RefreshCw className="size-4" aria-hidden="true" />重试
              </button>
            </div>
          ) : (loading && !catalog) || comparisonModels === null ? (
            <div className="grid min-h-72 place-items-center border-y border-border/70 text-sm text-muted-foreground">正在加载官方价格目录…</div>
          ) : comparisonRows.length === 0 ? (
            <div className="grid min-h-72 place-items-center border-y border-border/70 text-center text-sm text-muted-foreground">
              当前筛选条件下没有匹配的模型价格。
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead className="bg-muted/45 text-xs font-medium text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-3">模型</th>
                      <th scope="col" className="px-4 py-3">官方 API 价格</th>
                      <th scope="col" className="px-4 py-3">Helstera 实际扣费</th>
                      <th scope="col" className="px-4 py-3">核验状态</th>
                      <th scope="col" className="px-4 py-3">官方来源</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                  {comparisonRows.map((row) => <RuntimeComparisonTableRow key={`${row.model.mediaType}:${row.model.id}`} row={row} usdCnyRate={catalog?.usdCnyRate ?? USD_CNY_RATE} />)}
                  </tbody>
                </table>
              </div>
              <div className="space-y-3 md:hidden">
                {comparisonRows.map((row) => <RuntimeComparisonMobileRow key={`${row.model.mediaType}:${row.model.id}`} row={row} usdCnyRate={catalog?.usdCnyRate ?? USD_CNY_RATE} />)}
              </div>
            </>
          )}
        </section>

        <WorkspaceModelSection
          models={workspaceModels}
          modelCount={workspaceModelCount}
          error={workspaceError}
          onRetry={() => setWorkspaceReload((value) => value + 1)}
        />

        <RuntimeModelSection
          models={models}
          error={modelCatalogError}
          onRetry={() => setModelCatalogReload((value) => value + 1)}
        />

        <section className="mt-8 grid gap-6 border-y border-border/70 py-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2 className="text-base font-medium">一个余额，切换多家模型</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              官方美元报价按 USD/CNY {USD_CNY_RATE.toFixed(2)} 折算；价格会受分辨率、输入素材、模型选项、区域和税费影响，来源快照不代表固定报价。
            </p>
          </div>
          <a href="/register/" className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/85">
            开始体验
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </a>
        </section>

        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Image className="size-3.5" />图片官方价会注明分辨率与质量</span>
        <span className="inline-flex items-center gap-1.5"><Video className="size-3.5" />视频价格统一按每秒展示</span>
        </div>
      </main>
    </div>
  );
}

function RuntimeModelSection({
  models,
  error,
  onRetry,
}: {
  models: ListedModel[] | null;
  error: boolean;
  onRetry: () => void;
}) {
  const modelCount = new Set((models ?? []).map((model) => model.id)).size;
  return (
    <section className="mt-8" aria-labelledby="runtime-models-title" aria-busy={models === null && !error}>
      <header className="flex flex-col gap-1 border-b border-border/70 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="runtime-models-title" className="text-lg font-medium">模型目录</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {models ? `${modelCount} 个模型 · ${models.filter((model) => model.mediaType === "image").length} 个图片配置 · ${models.filter((model) => model.mediaType === "video").length} 个视频配置` : "与图片、视频生成器使用同一模型目录"}
          </p>
        </div>
      </header>
      {error ? (
        <div className="flex min-h-24 items-center justify-between gap-4 border-b border-border/70 py-4">
          <p className="text-sm text-muted-foreground">模型目录暂时无法读取。</p>
          <button type="button" onClick={onRetry} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">
            <RefreshCw className="size-4" aria-hidden="true" />重试
          </button>
        </div>
      ) : models === null ? (
        <div className="grid min-h-24 place-items-center border-b border-border/70 text-sm text-muted-foreground">正在读取模型目录…</div>
      ) : models.length === 0 ? (
        <div className="grid min-h-24 place-items-center border-b border-border/70 text-center text-sm text-muted-foreground">
          当前没有由生成接口公开的模型配置；工作区 Provider 配置见上方。
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="bg-muted/45 text-xs font-medium text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3">模型</th>
                <th scope="col" className="hidden px-4 py-3">Provider</th>
                <th scope="col" className="px-4 py-3">计费</th>
                <th scope="col" className="px-4 py-3">目录状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {models.map((model, index) => (
                <tr key={`${model.id}:${model.provider}:${index}`} className="align-top hover:bg-muted/25">
                  <td className="px-4 py-3">
                    <p className="font-medium">{model.displayName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{model.id} · {model.mediaType === "image" ? "图片" : "视频"}</p>
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground">{model.provider}</td>
                  <td className="px-4 py-3 tabular-nums">{formatListedModelPrice(model)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{model.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function toListedModel(
  model: ImageModelInfo | VideoModelInfo,
  mediaType: OfficialPriceMediaType,
  status: string,
): ListedModel {
  const accessStatus = model.accessible === false ? "登录或余额受限" : status;
  return {
    id: model.id,
    displayName: model.displayName,
    provider: model.provider,
    mediaType,
    ...(model.billingUnit ? { billingUnit: model.billingUnit } : {}),
    ...(typeof model.providerPriceCny === "number" || typeof model.creditCost === "number"
      ? { priceCny: model.providerPriceCny ?? model.creditCost }
      : {}),
    ...(typeof model.providerInputTokenPriceCny === "number" ? { inputPriceCny: model.providerInputTokenPriceCny } : {}),
    ...(typeof model.providerOutputTokenPriceCny === "number" ? { outputPriceCny: model.providerOutputTokenPriceCny } : {}),
    status: accessStatus,
  };
}

function dedupeListedModels(models: ListedModel[]): ListedModel[] {
  const unique = new Map<string, ListedModel>();
  for (const model of models) {
    if (model.billingUnit === "per_million_tokens") continue;
    const key = modelKey(model.mediaType, model.id);
    if (!unique.has(key)) unique.set(key, model);
  }
  return [...unique.values()];
}

function modelKey(mediaType: OfficialPriceMediaType, modelId: string) {
  return `${mediaType}:${modelId.trim().toLowerCase()}`;
}

function mergeListedModels(
  catalogModels: ListedModel[] | null,
  workspaceModels: WorkspaceModelPrice[] | null,
): ListedModel[] | null {
  if (catalogModels === null && workspaceModels === null) return null;

  const merged = new Map<string, ListedModel>();
  for (const model of workspaceModels ?? []) {
    if (model.billingUnit === "per_million_tokens") continue;
    merged.set(modelKey(model.mediaType, model.modelId), {
      id: model.modelId,
      displayName: model.displayName,
      provider: model.providerLabel,
      mediaType: model.mediaType,
      billingUnit: model.billingUnit,
      ...(model.priceCny != null ? { priceCny: model.priceCny } : {}),
      ...(model.inputPriceCny != null ? { inputPriceCny: model.inputPriceCny } : {}),
      ...(model.outputPriceCny != null ? { outputPriceCny: model.outputPriceCny } : {}),
      status: workspaceModelStatus(model),
    });
  }
  for (const model of catalogModels ?? []) {
    if (model.billingUnit === "per_million_tokens") continue;
    const key = modelKey(model.mediaType, model.id);
    if (!merged.has(key)) merged.set(key, model);
  }
  return [...merged.values()].sort((left, right) => {
    const mediaOrder = left.mediaType.localeCompare(right.mediaType);
    if (mediaOrder !== 0) return mediaOrder;
    return `${left.displayName}:${left.id}`.localeCompare(`${right.displayName}:${right.id}`);
  });
}

function formatListedModelPrice(model: ListedModel) {
  if (model.billingUnit === "per_million_tokens") {
    const input = model.inputPriceCny == null ? "—" : formatCny(model.inputPriceCny);
    const output = model.outputPriceCny == null ? "—" : formatCny(model.outputPriceCny);
    return `输入 ${input} / M · 输出 ${output} / M`;
  }
  if (model.priceCny == null) return "价格未配置";
  const unit = model.billingUnit === "per_second" ? "秒" : model.mediaType === "image" ? "张" : "次";
  return `${formatCny(model.priceCny)} / ${unit}`;
}

function WorkspaceModelSection({
  models,
  modelCount,
  error,
  onRetry,
}: {
  models: WorkspaceModelPrice[] | null;
  modelCount: number;
  error: "unauthorized" | "unavailable" | null;
  onRetry: () => void;
}) {
  return (
    <section className="mt-8" aria-labelledby="workspace-models-title" aria-busy={models === null && error === null}>
      <header className="flex flex-col gap-1 border-b border-border/70 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="workspace-models-title" className="text-lg font-medium">当前工作区模型</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {models ? `${modelCount} 个模型 · ${models.length} 个 Provider 配置项` : "模型计费按当前工作区配置显示"}
          </p>
        </div>
      </header>

      {error === "unauthorized" ? (
        <div className="flex min-h-28 items-center justify-between gap-4 border-b border-border/70 py-5">
          <p className="text-sm text-muted-foreground">登录后查看当前工作区配置的全部模型和计费价格。</p>
          <a href="/login/?redirect=/model-pricing/" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background">
            <LogIn className="size-4" aria-hidden="true" />登录
          </a>
        </div>
      ) : error === "unavailable" ? (
        <div className="flex min-h-28 items-center justify-between gap-4 border-b border-border/70 py-5">
          <p className="text-sm text-muted-foreground">工作区模型目录暂时不可用。</p>
          <button type="button" onClick={onRetry} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">
            <RefreshCw className="size-4" aria-hidden="true" />重试
          </button>
        </div>
      ) : models === null ? (
        <div className="grid min-h-28 place-items-center border-b border-border/70 text-sm text-muted-foreground">正在读取工作区模型…</div>
      ) : models.length === 0 ? (
        <div className="grid min-h-28 place-items-center border-b border-border/70 text-center text-sm text-muted-foreground">
          当前工作区还没有配置 Provider 模型。
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="bg-muted/45 text-xs font-medium text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3">模型</th>
                <th scope="col" className="hidden px-4 py-3">Provider</th>
                <th scope="col" className="px-4 py-3">工作区价格</th>
                <th scope="col" className="px-4 py-3">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {models.map((model) => (
                <tr key={`${model.providerLabel}:${model.modelId}`} className="align-top hover:bg-muted/25">
                  <td className="px-4 py-3">
                    <p className="font-medium">{model.displayName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{model.modelId} · {model.mediaType === "image" ? "图片" : "视频"}</p>
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground">{model.providerLabel}</td>
                  <td className="px-4 py-3 tabular-nums">{formatWorkspacePrice(model)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{workspaceModelStatus(model)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
        工作区价格来自 Provider 配置及当前平台计费规则；官方 API 最高价在下方单独列示。Token 单价按每百万 token 计。
      </p>
    </section>
  );
}

function formatWorkspacePrice(model: WorkspaceModelPrice) {
  if (model.billingUnit === "per_million_tokens") {
    const input = model.inputPriceCny == null ? "未配置" : `${formatCny(model.inputPriceCny)} / M`;
    const output = model.outputPriceCny == null ? "未配置" : `${formatCny(model.outputPriceCny)} / M`;
    return `输入 ${input} · 输出 ${output}`;
  }
  if (model.priceCny == null) return "价格未配置";
  const unit = model.billingUnit === "per_second" ? "秒" : "次";
  return `${formatCny(model.priceCny)} / ${unit}`;
}

function workspaceModelStatus(model: WorkspaceModelPrice) {
  if (!model.providerEnabled || !model.modelEnabled) return "已停用";
  if (model.providerHealth === "unhealthy" || model.modelHealth === "unhealthy") return "暂不可用";
  if (model.modelHealth === "unknown" || model.providerHealth !== "healthy") return "待验证";
  return "已启用";
}

function getRuntimeComparison(price: OfficialModelPrice, models: ListedModel[] | null, modelCatalogError: boolean, usdCnyRate: number) {
  if (price.unit === "per_million_tokens") return null;
  if (!models || modelCatalogError) return null;
  const model = findRuntimePriceModel(price.modelId, price.mediaType, models);
  if (!model || model.priceCny == null) return null;
  if (price.unit === "per_second" && model.billingUnit !== "per_second") return null;
  if (price.unit === "per_image" && model.billingUnit !== "per_generation") return null;
  return compareRuntimePrice(model.priceCny, price.officialMax * usdCnyRate);
}

function RuntimePriceValue({ price, models, modelCatalogError }: { price: OfficialModelPrice; models: ListedModel[] | null; modelCatalogError: boolean }) {
  if (price.unit === "per_million_tokens") return <p className="mt-0.5 text-sm text-muted-foreground">官方按 token 计费，不与每张/每秒直接比较</p>;
  if (modelCatalogError) return <p className="mt-0.5 text-sm text-muted-foreground">暂不可查询</p>;
  if (!models) return <p className="mt-0.5 text-sm text-muted-foreground">读取中</p>;
  const model = findRuntimePriceModel(price.modelId, price.mediaType, models);
  if (!model || model.priceCny == null) return <p className="mt-0.5 text-sm text-muted-foreground">未配置同款</p>;
  if ((price.unit === "per_second" && model.billingUnit !== "per_second") || (price.unit === "per_image" && model.billingUnit !== "per_generation")) {
    return <p className="mt-0.5 text-sm text-muted-foreground">计费单位不匹配</p>;
  }
  return <><p className="mt-0.5 text-sm font-medium">{formatCny(model.priceCny)} / {price.unit === "per_second" ? "秒" : "张"}</p><p className="text-xs text-muted-foreground">现行积分扣费 · 1 cr = ¥1</p></>;
}

function RuntimeComparisonLabel({ comparison, models, modelCatalogError }: { comparison: ReturnType<typeof getRuntimeComparison>; models: ListedModel[] | null; modelCatalogError: boolean }) {
  if (modelCatalogError || !models) return null;
  if (!comparison) return <p className="mt-1 text-xs text-muted-foreground">暂无同款配置，未计算差价</p>;
  return <p className={`mt-1 text-xs ${comparison.relation === "above" ? "text-rose-700" : comparison.relation === "below" ? "text-emerald-700" : "text-muted-foreground"}`}>{getComparisonLabel(comparison.relation, comparison.deltaCny, comparison.officialMaxCny)}</p>;
}

type ComparisonRow = { model: ListedModel; official: OfficialModelPrice | null };

function buildComparisonRows(models: ListedModel[] | null, prices: OfficialModelPrice[], media: MediaFilter, query: string): ComparisonRow[] {
  if (!models) return [];
  const search = query.trim().toLowerCase();
  const seen = new Set<string>();
  return models.filter((model) => {
    if (model.billingUnit === "per_million_tokens") return false;
    if (media !== "all" && model.mediaType !== media) return false;
    if (seen.has(`${model.mediaType}:${model.id}`)) return false;
    seen.add(`${model.mediaType}:${model.id}`);
    if (!search) return true;
    return `${model.displayName} ${model.id}`.toLowerCase().includes(search);
  }).map((model) => ({
    model,
    official: prices
      .filter((price) => findRuntimePriceModel(price.modelId, price.mediaType, [model]) !== null)
      .sort((left, right) => right.officialMax - left.officialMax)[0] ?? null,
  }));
}

function RuntimeComparisonTableRow({ row, usdCnyRate }: { row: ComparisonRow; usdCnyRate: number }) {
  const official = row.official;
  const comparison = official && official.unit !== "per_million_tokens" && row.model.billingUnit !== "per_million_tokens" && row.model.priceCny != null
    ? compareRuntimePrice(row.model.priceCny, official.officialMax * usdCnyRate)
    : null;
  return (
    <tr className="bg-card align-top transition-colors hover:bg-muted/25">
      <td className="px-4 py-4">
        <p className="font-medium">{row.model.displayName}</p>
        <p className="mt-1 text-xs text-muted-foreground">{row.model.id} · {row.model.mediaType === "image" ? "图片" : "视频"}</p>
      </td>
      <td className="px-4 py-4 tabular-nums">
        {official ? <>
          <p className="font-medium">{formatOfficial(official)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{official.variant}</p>
          {isOpenAiTokenEstimate(official) && <p className="mt-1 max-w-56 text-xs leading-5 text-muted-foreground">OpenAI 官方 Token 计费换算估算，非固定按张价</p>}
        </> : <>
          <p className="font-medium">暂无官方价格</p>
          <p className="mt-1 text-xs text-muted-foreground">公开参考价：{formatListedModelPrice(row.model)}</p>
        </>}
      </td>
      <td className="px-4 py-4 tabular-nums">
        <p className="font-medium">{formatListedModelPrice(row.model)}</p>
        {comparison && <p className={`mt-1 text-xs ${comparison.relation === "above" ? "text-rose-700" : "text-emerald-700"}`}>{getComparisonLabel(comparison.relation, comparison.deltaCny, comparison.officialMaxCny)}</p>}
      </td>
      <td className="px-4 py-4 text-xs text-muted-foreground">{row.model.status}</td>
      <td className="px-4 py-4">{official ? <SourceLink price={official} /> : <span className="text-xs text-muted-foreground">当前目录参考价</span>}</td>
    </tr>
  );
}

function RuntimeComparisonMobileRow({ row, usdCnyRate }: { row: ComparisonRow; usdCnyRate: number }) {
  const official = row.official;
  const comparison = official && official.unit !== "per_million_tokens" && row.model.billingUnit !== "per_million_tokens" && row.model.priceCny != null
    ? compareRuntimePrice(row.model.priceCny, official.officialMax * usdCnyRate)
    : null;
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium">{row.model.displayName}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{row.model.id} · {row.model.mediaType === "image" ? "图片" : "视频"}</p>
      <div className="mt-4 space-y-2 border-y border-border/70 py-3 text-sm">
        <p><span className="text-xs text-muted-foreground">{official ? "官方最高价" : "暂无官方价格"}</span><br />{official ? formatOfficial(official) : `公开参考价：${formatListedModelPrice(row.model)}`}</p>
        <p><span className="text-xs text-muted-foreground">Helstera 当前价格</span><br />{formatListedModelPrice(row.model)}</p>
        {comparison && <p className={`text-xs ${comparison.relation === "above" ? "text-rose-700" : "text-emerald-700"}`}>{getComparisonLabel(comparison.relation, comparison.deltaCny, comparison.officialMaxCny)}</p>}
      </div>
      {official ? <SourceLink price={official} /> : <span className="text-xs text-muted-foreground">当前目录参考价 · 非官方</span>}
    </article>
  );
}

function LegacyRuntimeComparisonTableRow({ row, usdCnyRate }: { row: ComparisonRow; usdCnyRate: number }) {
  const official = row.official;
  const comparison = official && row.model.priceCny != null
    ? compareRuntimePrice(row.model.priceCny, official.officialMax * usdCnyRate)
    : null;
  return (
    <tr className="bg-card align-top transition-colors hover:bg-muted/25">
      <td className="px-4 py-4"><p className="font-medium">{row.model.displayName}</p><p className="mt-1 text-xs text-muted-foreground">{row.model.id} · {row.model.mediaType === "image" ? "图片" : "视频"}</p></td>
      <td className="px-4 py-4 tabular-nums">{official ? <><p className="font-medium">{formatOfficial(official)}</p><p className="mt-1 text-xs text-muted-foreground">{official.variant}</p></> : <><p className="font-medium">{row.model.priceCny == null ? "暂无价格" : `${formatCny(row.model.priceCny)} / ${row.model.billingUnit === "per_second" ? "秒" : "张"}`}</p><p className="mt-1 text-xs text-muted-foreground">公开参考价 · 非官方</p></>}</td>
      <td className="px-4 py-4 tabular-nums">{row.model.priceCny == null ? <p className="text-sm text-muted-foreground">未配置价格</p> : <><p className="font-medium">{formatCny(row.model.priceCny)} / {row.model.billingUnit === "per_second" ? "秒" : "张"}</p><p className="mt-1 text-xs text-muted-foreground">现行积分扣费 · 1 cr = ¥1</p>{comparison && <p className={`mt-1 text-xs ${comparison.relation === "above" ? "text-rose-700" : "text-emerald-700"}`}>{getComparisonLabel(comparison.relation, comparison.deltaCny, comparison.officialMaxCny)}</p>}</>}</td>
      <td className="px-4 py-4 text-xs text-muted-foreground">{row.model.status}</td>
      <td className="px-4 py-4">{official ? <SourceLink price={official} /> : <span className="text-xs text-muted-foreground">当前目录配置</span>}</td>
    </tr>
  );
}

function LegacyRuntimeComparisonMobileRow({ row, usdCnyRate }: { row: ComparisonRow; usdCnyRate: number }) {
  const official = row.official;
  const comparison = official && row.model.priceCny != null ? compareRuntimePrice(row.model.priceCny, official.officialMax * usdCnyRate) : null;
  return <article className="rounded-lg border border-border bg-card p-4"><h2 className="text-sm font-medium">{row.model.displayName}</h2><p className="mt-1 text-xs text-muted-foreground">{row.model.id} · {row.model.mediaType === "image" ? "图片" : "视频"}</p><div className="mt-4 space-y-2 border-y border-border/70 py-3 text-sm"><p><span className="text-xs text-muted-foreground">{official ? "官方最高价" : "公开参考价"}</span><br />{official ? formatOfficial(official) : row.model.priceCny == null ? "暂无价格" : `${formatCny(row.model.priceCny)} / ${row.model.billingUnit === "per_second" ? "秒" : "张"}`}</p><p><span className="text-xs text-muted-foreground">Helstera 现行扣费</span><br />{row.model.priceCny == null ? "未配置价格" : `${formatCny(row.model.priceCny)} / ${row.model.billingUnit === "per_second" ? "秒" : "张"}`}</p>{comparison && <p className={`text-xs ${comparison.relation === "above" ? "text-rose-700" : "text-emerald-700"}`}>{getComparisonLabel(comparison.relation, comparison.deltaCny, comparison.officialMaxCny)}</p>}</div>{official ? <SourceLink price={official} /> : <span className="text-xs text-muted-foreground">当前目录配置 · 非官方</span>}</article>;
}

function PriceTableRow({ price, sources, usdCnyRate, models, modelCatalogError }: { price: OfficialModelPrice; sources: OfficialModelPriceCatalog["sources"]; usdCnyRate: number; models: ListedModel[] | null; modelCatalogError: boolean }) {
  const comparison = getRuntimeComparison(price, models, modelCatalogError, usdCnyRate);
  return (
    <tr className="bg-card align-top transition-colors hover:bg-muted/25 [&_td:first-child>p:nth-child(2)]:hidden">
      <td className="px-4 py-4">
        <p className="font-medium">{price.modelName}</p>
        <p className="mt-1 text-xs text-muted-foreground">{price.variant}</p>
      </td>
      <td className="px-4 py-4 tabular-nums">
        <p className="font-medium">{formatOfficial(price)}</p>
        <p className="mt-1 text-xs text-muted-foreground">CNY · {price.unitLabel}</p>
        <div className="mt-2 border-t border-border/70 pt-2">
          <p className="text-xs text-muted-foreground">{"Helstera \u6263\u8d39"}</p>
          <RuntimePriceValue price={price} models={models} modelCatalogError={modelCatalogError} />
          <RuntimeComparisonLabel comparison={comparison} models={models} modelCatalogError={modelCatalogError} />
        </div>
      </td>
      <td className="max-w-64 px-4 py-4 text-xs leading-5 text-muted-foreground">
        <PriceFreshness price={price} sources={sources} />
        {price.note && <p className="mt-1.5">{price.note}</p>}
      </td>
      <td className="px-4 py-4">
        <SourceLink price={price} />
      </td>
    </tr>
  );
}

function PriceMobileRow({ price, sources, usdCnyRate, models, modelCatalogError }: { price: OfficialModelPrice; sources: OfficialModelPriceCatalog["sources"]; usdCnyRate: number; models: ListedModel[] | null; modelCatalogError: boolean }) {
  const comparison = getRuntimeComparison(price, models, modelCatalogError, usdCnyRate);
  return (
    <article className="rounded-lg border border-border bg-card p-4 [&_header_p]:hidden">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{price.modelName}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{price.variant}</p>
        </div>
        {price.mediaType === "image" ? <Image className="size-4 shrink-0 text-muted-foreground" /> : <Video className="size-4 shrink-0 text-muted-foreground" />}
      </header>
      <div className="mt-4 border-y border-border/70 py-3 text-sm">
        <p className="text-xs text-muted-foreground">官方 API 最高价</p>
        <p className="mt-1 font-medium tabular-nums">{formatOfficial(price)}</p>
        {isOpenAiTokenEstimate(price) && <p className="mt-1 text-xs leading-5 text-muted-foreground">OpenAI 官方 Token 计费换算估算，非固定按张价</p>}
        <div className="mt-3 border-t border-border/70 pt-3">
          <p className="text-xs text-muted-foreground">{"Helstera \u6263\u8d39"}</p>
          <RuntimePriceValue price={price} models={models} modelCatalogError={modelCatalogError} />
          <RuntimeComparisonLabel comparison={comparison} models={models} modelCatalogError={modelCatalogError} />
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div className="min-w-0 text-xs leading-5 text-muted-foreground">
          <PriceFreshness price={price} sources={sources} />
          {price.note && <p className="mt-1">{price.note}</p>}
        </div>
        <SourceLink price={price} />
      </div>
    </article>
  );
}

function PriceFreshness({ price, sources }: { price: OfficialModelPrice; sources: OfficialModelPriceCatalog["sources"] }) {
  const source = sources.find((item) => item.sourceId === price.sourceId);
  if (source?.status === "success" && price.lastVerifiedAt) {
    return <span>自动抓取 · {formatDateTime(price.lastVerifiedAt)}</span>;
  }
  if (source?.status === "failed") {
    return <span>自动源暂不可达 · 官方快照 {price.snapshotDate}</span>;
  }
  if (source?.status === "pending") {
    return <span>首次自动核验中 · 官方快照 {price.snapshotDate}</span>;
  }
  return <span>官方快照 · {price.snapshotDate}</span>;
}

function SourceLink({ price }: { price: OfficialModelPrice }) {
  return (
    <a href={price.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      来源
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
}

function getComparisonLabel(relation: "below" | "equal" | "above", deltaCny: number, officialMaxCny: number) {
  if (relation === "equal") return "\u4e0e\u5b98\u65b9\u6700\u9ad8\u4ef7\u6301\u5e73";
  const percent = officialMaxCny > 0 ? Math.round(Math.abs(deltaCny) / officialMaxCny * 100) : 0;
  const direction = relation === "above" ? "\u9ad8\u4e8e" : "\u4f4e\u4e8e";
  return `${direction}\u5b98\u65b9\u6700\u9ad8\u4ef7 ${percent}%`;
}

function SourceSummary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium tabular-nums">{value}</p>
    </div>
  );
}

function formatOfficial(price: OfficialModelPrice) {
  const amount = formatCny(price.officialMax * USD_CNY_RATE);
  const unit = price.unit === "per_second" ? "秒" : price.unit === "per_image" ? "张" : "百万 tokens";
  return `${amount} / ${unit}`;
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
