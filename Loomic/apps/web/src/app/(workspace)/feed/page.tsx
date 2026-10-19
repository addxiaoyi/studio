"use client";

import {
  ArrowRight,
  Check,
  Download,
  Loader2,
  PenLine,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
import { useAuth } from "@/lib/auth-context";
import { useCreateProject } from "@/hooks/use-create-project";
import {
  buildFeedPrompt,
  FEED_CONTENT_TYPES,
  FEED_GOALS,
  FEED_PLATFORMS,
  getFeedDurations,
  type FeedContentType,
  type FeedGoal,
} from "@/lib/feed-workflow";
import {
  createFeedPackage,
  createFeedAutomation,
  fetchFeedAutomation,
  retryFeedAutomation,
  createDouyinJumpLink,
  createFeedSchedule,
  approveFeedStructure,
  fetchPublishingAccounts,
  actOnFeedSchedule,
  downloadFeedManifest,
  downloadFeedTimeline,
  fetchFeedPackage,
  fetchFeedRenderStatus,
  fetchFeedInsights,
  updateFeedVariant,
  readaptFeedVariant,
  generateFeedStructure,
  previewFeedMetricsCsv,
  downloadFeedMetricsTemplate,
  importFeedMetrics,
  fetchFeedPackages,
  fetchFeedTrends,
  fetchFeedSources,
  renderFeedPackage,
  saveFeedStructureDraft,
  syncFeedTrends,
  fetchVideoModels,
  saveFeedMetric,
  uploadFile,
  type FeedPackageRecord,
  type FeedContentVariant,
  type FeedTrendItem,
  type VideoModelInfo,
  type PublishingAccount,
  type FeedTrendSource,
  type FeedAutomationRun,
} from "@/lib/server-api";
import { getModelPricingLabel } from "@/lib/model-pricing";
import { cn } from "@/lib/utils";
import { Strands } from "@/components/strands";

function Suggestion({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2"><span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span></div>;
}

const platforms = [
  ["douyin", "抖音"],
  ["xiaohongshu", "小红书"],
  ["kuaishou", "快手"],
  ["zhihu", "知乎"],
  ["bilibili", "B站"],
  ["wechat_channels", "视频号"],
  ["wechat_official", "公众号"],
  ["tiktok", "TikTok"],
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["youtube", "YouTube"],
  ["pinterest", "Pinterest"],
  ["x", "X"],
] as const;
const steps = ["选题", "策略", "脚本", "生成", "适配", "发布与复盘"];
type FeedStructure = FeedPackageRecord["structure"];
type FeedStep = 0 | 1 | 2 | 3 | 4 | 5;
type ScheduleDraft = {
  accountId: string;
  publishMode: PublishingAccount["connection_mode"];
  scheduledAt: string;
  planId: string;
};

function parseFeedStep(value: string | null): FeedStep {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5 ? parsed as FeedStep : 0;
}

const packageStatusLabels: Record<string, string> = {
  draft: "草稿",
  structured: "结构待审",
  approved: "已批准",
  rendering: "生成中",
  failed: "生成失败",
  ready: "待发布",
  scheduled: "已排期",
  exported: "已导出",
  published: "已发布",
  measured: "已录入指标",
  analyzed: "已复盘",
};

const automationStageLabels: Record<string, string> = {
  trend_analysis: "分析热点",
  strategy: "生成策略",
  structure: "生成内容结构",
  review: "等待审阅",
  completed: "已完成",
};

function packageNextAction(status: string): string {
  if (["draft", "structured"].includes(status)) return "完成并保存结构后批准";
  if (status === "approved") return "开始生成图片与视频";
  if (status === "rendering") return "等待后台任务完成";
  if (status === "failed") return "检查失败任务后重试生成";
  if (status === "ready") return "核对平台适配并人工排期";
  if (["scheduled", "exported", "published"].includes(status)) return "补充发布结果和复盘指标";
  return "查看最新内容包状态";
}

export default function FeedPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useAuth();
  const { create, creating } = useCreateProject();
  const token = session?.access_token;
  const requestedPackageId = searchParams.get("packageId");
  const requestedStep = parseFeedStep(searchParams.get("step"));
  const [step, setStep] = useState<FeedStep>(requestedStep);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [referenceImages, setReferenceImages] = useState<Array<{ assetId: string; url: string }>>([]);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [goal, setGoal] = useState<FeedGoal>("直接转化");
  const [contentType, setContentType] = useState<FeedContentType>("种草转化");
  const [duration, setDuration] = useState(15);
  const [models, setModels] = useState<VideoModelInfo[]>([]);
  const [model, setModel] = useState("auto");
  const [mode, setMode] = useState<"review" | "automatic">("review");
  const [maxCostCny, setMaxCostCny] = useState(5);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([
    "douyin",
    "xiaohongshu",
  ]);
  const [query, setQuery] = useState("");
  const [trendPage, setTrendPage] = useState(1);
  const [trendSort, setTrendSort] = useState<"heat" | "latest">("heat");
  const [trendTotal, setTrendTotal] = useState(0);
  const [trendTotalPages, setTrendTotalPages] = useState(1);
  const [trends, setTrends] = useState<FeedTrendItem[]>([]);
  const [packages, setPackages] = useState<FeedPackageRecord[]>([]);
  const [active, setActive] = useState<FeedPackageRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduleAction, setScheduleAction] = useState<"save" | "confirm" | "publish" | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [structureSaving, setStructureSaving] = useState(false);
  const [renderRefreshing, setRenderRefreshing] = useState(false);
  const [mediaStarting, setMediaStarting] = useState(false);
  const [structureGenerating, setStructureGenerating] = useState(false);
  const [error, setError] = useState("");
  const [partialNotice, setPartialNotice] = useState("");
  const [accountAlias, setAccountAlias] = useState("");
  const [accounts, setAccounts] = useState<PublishingAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [publishMode, setPublishMode] = useState<PublishingAccount["connection_mode"]>("scan_confirm");
  const [publishPlatform, setPublishPlatform] = useState("douyin");
  const [scheduledAt, setScheduledAt] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [douyinTarget, setDouyinTarget] = useState("");
  const [douyinLinks, setDouyinLinks] = useState<Record<string, string>>({});
  const [douyinLinkBusy, setDouyinLinkBusy] = useState<string | null>(null);
  const [impressions, setImpressions] = useState(0);
  const [views, setViews] = useState(0);
  const [completions, setCompletions] = useState(0);
  const [likes, setLikes] = useState(0);
  const [comments, setComments] = useState(0);
  const [shares, setShares] = useState(0);
  const [saves, setSaves] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [leads, setLeads] = useState(0);
  const [conversions, setConversions] = useState(0);
  const [spend, setSpend] = useState(0);
  const [revenue, setRevenue] = useState(0);
  const [notice, setNotice] = useState("");
  const [strategyPrompt, setStrategyPrompt] = useState("");
  const [strategyBusy, setStrategyBusy] = useState(false);
  const [automationRun, setAutomationRun] = useState<FeedAutomationRun | null>(null);
  const [insightView, setInsightView] = useState<{ summary: Record<string, number> | null; recommendations: string[] } | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvPreview, setCsvPreview] = useState<{ records: Record<string, unknown>[]; errors: Array<{ row: number; message: string }> } | null>(null);
  const [csvImportResult, setCsvImportResult] = useState<{ imported: number; rejected: number; errors: Array<{ row: number; message: string }> } | null>(null);
  const [sources, setSources] = useState<FeedTrendSource[]>([]);
  const [selectedTrendId, setSelectedTrendId] = useState<string | null>(null);
  const [structureDraft, setStructureDraft] = useState<FeedStructure | null>(null);
  const [structureDirty, setStructureDirty] = useState(false);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [variantDraft, setVariantDraft] = useState<{ title: string; body: string; hashtags: string; coverText: string; locked: boolean } | null>(null);
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, ScheduleDraft>>({});
  const didLoadRef = useRef(false);
  const trendRequestRef = useRef(0);
  const restoredUrlRef = useRef<string | null>(null);
  const automationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => automationAbortRef.current?.abort(), []);

  const activeVariants = active?.variants ?? [];
  const currentVariant = activeVariants.find((item) => item.platform === publishPlatform);
  const reviewedStructure = structureDraft ?? active?.structure ?? null;
  const structureValid = Boolean(
    reviewedStructure &&
    [
      reviewedStructure.title,
      reviewedStructure.audience,
      reviewedStructure.painPoint,
      reviewedStructure.angle,
      reviewedStructure.hypothesis,
      reviewedStructure.hook,
      reviewedStructure.cta,
      reviewedStructure.imagePrompt,
      reviewedStructure.videoPrompt,
    ].every((value) => value.trim()) &&
    reviewedStructure.shots.length > 0 &&
    reviewedStructure.shots.every((shot) => shot.visual.trim() && shot.voiceover.trim() && shot.subtitle.trim()),
  );

  async function loadTrends(options?: { page?: number; sort?: "heat" | "latest"; query?: string }) {
    if (!token) return;
    const nextPage = options?.page ?? trendPage;
    const nextSort = options?.sort ?? trendSort;
    const nextQuery = options?.query ?? query;
    const requestId = ++trendRequestRef.current;
    setTrendLoading(true);
    try {
      const nextTrends = await fetchFeedTrends(token, nextQuery, nextPage, nextSort);
      if (requestId !== trendRequestRef.current) return;
      setTrends(nextTrends.items);
      setTrendPage(nextTrends.page);
      setTrendTotal(nextTrends.total);
      setTrendTotalPages(nextTrends.totalPages);
    } catch (err) {
      if (requestId !== trendRequestRef.current) return;
      setError(err instanceof Error ? err.message : "热点加载失败，请重试");
    } finally {
      if (requestId === trendRequestRef.current) setTrendLoading(false);
    }
  }

  async function loadWorkspaceData() {
    if (!token) return;
    setWorkspaceLoading(true);
    try {
      const [nextPackages, catalog, nextAccounts, nextSources] = await Promise.all([
        fetchFeedPackages(token),
        fetchVideoModels(),
        fetchPublishingAccounts(token),
        fetchFeedSources(token),
      ]);
      setPackages(nextPackages);
      setModels(catalog.models.filter((item) => item.accessible !== false));
      setAccounts(nextAccounts);
      setSources(nextSources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "工作区数据加载失败，请重试");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function refreshAll() {
    if (!token) return;
    setInitialLoading(true);
    setError("");
    await Promise.allSettled([
      loadTrends({ page: 1 }),
      loadWorkspaceData(),
    ]);
    didLoadRef.current = true;
    setInitialLoading(false);
  }

  async function syncTrends() {
    if (!token) return;
    setSyncing(true);
    setError("");
    setPartialNotice("");
    try {
      const result = await syncFeedTrends(token);
      await loadTrends({ page: 1 });
      if (result.partial) {
        setPartialNotice(result.message ?? "部分热点源同步失败，已保留成功获取的热点。");
      } else {
        setNotice("系统热点已刷新。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "实时热点同步失败，请稍后重试");
    } finally {
      setSyncing(false);
    }
  }
  useEffect(() => {
    didLoadRef.current = false;
    void refreshAll();
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (token && didLoadRef.current) void loadTrends({ page: 1, query });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query]);

  const selectedModel = useMemo(
    () => models.find((item) => item.id === model),
    [model, models],
  );
  const availableDurations = useMemo(
    () => getFeedDurations(models, model),
    [models, model],
  );
  const estimatedCost =
    selectedModel?.billingUnit === "per_second" &&
    typeof selectedModel.providerPriceCny === "number"
      ? selectedModel.providerPriceCny * duration
      : null;
  const estimated =
    estimatedCost === null
      ? `按 ${duration} 秒视频 + 1 张首帧预估，最终以实际健康路由为准`
      : `${selectedModel?.displayName} · ${duration} 秒 · 预计 ¥${estimatedCost.toFixed(2)}`;
  useEffect(() => {
    if (availableDurations.length && !availableDurations.includes(duration))
      setDuration(
        availableDurations.includes(15) ? 15 : availableDurations[0]!,
      );
  }, [availableDurations, duration]);
  function togglePlatform(id: string) {
    setSelectedPlatforms((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      if (next.length && !next.includes(publishPlatform)) setPublishPlatform(next[0]!);
      if (!next.length) setPublishPlatform("");
      return next;
    });
  }
  async function uploadReferenceImages(files: FileList | null) {
    if (!token || !files?.length) return;
    const selected = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, 4);
    if (!selected.length) {
      setError("请选择 PNG、JPG、WEBP 或 GIF 图片");
      return;
    }
    setReferenceUploading(true);
    setError("");
    try {
      const uploaded = [] as Array<{ assetId: string; url: string }>;
      for (const file of selected) {
        const result = await uploadFile(token, file);
        uploaded.push({ assetId: result.asset.id, url: result.url });
      }
      setReferenceImages((current) => [...current, ...uploaded].slice(0, 8));
      setNotice(`已上传 ${uploaded.length} 张商品参考图，生成时会作为强约束输入。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "参考图上传失败");
    } finally {
      setReferenceUploading(false);
    }
  }
  function chooseTrend(item: FeedTrendItem) {
    setSelectedTrendId(item.id);
    setTitle(item.title);
    setBrief(item.summary || `围绕${item.title}制作真实、可验证的商品内容`);
    setNotice(`已关联真实热点：${item.title}`);
    setStep(1);
  }
  function startCustomTopic() {
    setSelectedTrendId(null);
    setTitle("");
    setBrief("");
    setNotice("自定义选题不会关联热点，可以直接进入内容策略。");
    setStep(1);
  }

  function selectPublishPlatform(platformId: string) {
    if (publishPlatform) {
      setScheduleDrafts((current) => ({
        ...current,
        [publishPlatform]: {
          ...(current[publishPlatform] ?? { planId: "" }),
          accountId,
          publishMode,
          scheduledAt,
        },
      }));
    }
    setPublishPlatform(platformId);
    const draft = scheduleDrafts[platformId];
    setAccountId(draft?.accountId ?? "");
    setPublishMode(draft?.publishMode ?? "scan_confirm");
    setScheduledAt(draft?.scheduledAt ?? "");
    setPostUrl("");
  }

  function selectAccount(nextAccountId: string) {
    setAccountId(nextAccountId);
    const account = accounts.find((item) => item.id === nextAccountId);
    if (account) setAccountAlias(account.alias);
  }

  function updateStructure<K extends keyof FeedStructure>(
    key: K,
    value: FeedStructure[K],
  ) {
    setStructureDraft((current) => (current ? { ...current, [key]: value } : current));
    setStructureDirty(true);
  }

  function updateShot(
    shotId: string,
    key: "visual" | "voiceover" | "subtitle",
    value: string,
  ) {
    setStructureDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        shots: current.shots.map((shot) =>
          shot.id === shotId ? { ...shot, [key]: value } : shot,
        ),
      };
    });
    setStructureDirty(true);
  }

  function goToStep(nextStep: number) {
    const target = parseFeedStep(String(nextStep));
    if (target === step) return;
    if (structureDirty && step === 2 && target !== 2 && !window.confirm("结构有未保存修改，确定离开吗？")) return;
    if (target >= 2 && !active) {
      setError("请先选择热点或创建内容包，再进入后续步骤。");
      return;
    }
    setStep(target);
  }

  async function hydratePackage(packageRecord: FeedPackageRecord) {
    setActive(packageRecord);
    setStructureDraft(packageRecord.structure);
    setStructureDirty(false);
    setSelectedTrendId(packageRecord.trend_item_id ?? null);
    setTitle(packageRecord.title);
    setBrief(packageRecord.brief);
    setSelectedPlatforms(packageRecord.platforms);
    if (packageRecord.platforms[0]) setPublishPlatform(packageRecord.platforms[0]);
    if (!token) return;
    try {
      const detail = await fetchFeedPackage(token, packageRecord.id);
      setActive(detail);
      setStructureDraft(detail.structure);
      setSelectedTrendId(detail.trend_item_id ?? null);
      setTitle(detail.title);
      setBrief(detail.brief);
    } catch (err) {
      setError(err instanceof Error ? err.message : "内容包详情加载失败，请重试");
    }
  }

  async function refreshActivePackage() {
    if (!token || !active) return;
    setRenderRefreshing(true);
    try {
      const detail = await fetchFeedPackage(token, active.id);
      if (structureDirty) {
        setError("服务端内容包已刷新，但本地未保存结构仍保留；保存或放弃修改后再继续。");
        setActive((current) => current ? { ...current, status: detail.status, ...(detail.variants ? { variants: detail.variants } : {}) } : current);
      } else {
        await hydratePackage(detail);
      }
      setNotice("内容包状态已刷新。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "内容包刷新失败，请稍后重试。");
    } finally {
      setRenderRefreshing(false);
    }
  }

  async function openPackage(packageRecord: FeedPackageRecord) {
    if (structureDirty && !window.confirm("结构有未保存修改，打开其他内容包会放弃这些修改，确定继续吗？")) return;
    await hydratePackage(packageRecord);
    setStep(2);
  }

  useEffect(() => {
    if (!token || !didLoadRef.current || !requestedPackageId) return;
    const restoreKey = `${requestedPackageId}:${requestedStep}`;
    if (restoredUrlRef.current === restoreKey) return;
    const listed = packages.find((item) => item.id === requestedPackageId);
    restoredUrlRef.current = restoreKey;
    void (async () => {
      try {
        const packageRecord = listed ?? await fetchFeedPackage(token, requestedPackageId);
        await hydratePackage(packageRecord);
        setStep(requestedStep);
      } catch (err) {
        setError(err instanceof Error ? err.message : "无法恢复 URL 中的内容包。");
      }
    })();
  }, [token, packages, requestedPackageId, requestedStep]);

  useEffect(() => {
    if (!token || !active?.id || active.status !== "rendering") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await fetchFeedRenderStatus(token, active.id);
        if (cancelled) return;
        setActive((current) => current ? { ...current, status: status.status, renderJobs: status.jobs } : current);
        if (status.status === "ready") {
          setNotice("图片与视频已生成完成，可以进入平台适配。");
          setStep(4);
        } else if (status.status === "failed") {
          setError("媒体生成失败，请查看下方任务原因并重试。");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "媒体状态查询失败，请手动刷新。");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, active?.id, active?.status]);

  useEffect(() => {
    if (!didLoadRef.current || (requestedPackageId && active?.id !== requestedPackageId)) return;
    const params = new URLSearchParams(window.location.search);
    if (active?.id) params.set("packageId", active.id);
    else params.delete("packageId");
    params.set("step", String(step));
    router.replace(`/feed?${params.toString()}`, { scroll: false });
  }, [active?.id, requestedPackageId, router, step]);

  useEffect(() => {
    if (!structureDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [structureDirty]);

  function beginVariantEdit(variant: FeedContentVariant) {
    setEditingVariantId(variant.id);
    setVariantDraft({ title: variant.title, body: variant.body, hashtags: variant.hashtags.join(", "), coverText: variant.cover_text, locked: Boolean(variant.locked) });
  }

  async function saveVariantEdit() {
    if (!token || !active || !editingVariantId || !variantDraft) return;
    try {
      const updated = await updateFeedVariant(token, active.id, editingVariantId, {
        title: variantDraft.title,
        body: variantDraft.body,
        hashtags: variantDraft.hashtags.split(",").map((tag) => tag.trim()).filter(Boolean),
        coverText: variantDraft.coverText,
        locked: variantDraft.locked,
      });
      setActive((current) => current ? { ...current, variants: (current.variants ?? []).some((item) => item.id === updated.id) ? (current.variants ?? []).map((item) => item.id === updated.id ? updated : item) : (current.variants ?? []).map((item) => item.platform === updated.platform ? updated : item) } : current);
      setEditingVariantId(null);
      setVariantDraft(null);
      setNotice("平台变体已保存。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "平台变体保存失败");
    }
  }

  async function readaptVariant(variantId: string) {
    if (!token || !active) return;
    try {
      const updated = await readaptFeedVariant(token, active.id, variantId);
      setActive((current) => current ? { ...current, variants: (current.variants ?? []).some((item) => item.id === updated.id) ? (current.variants ?? []).map((item) => item.id === updated.id ? updated : item) : (current.variants ?? []).map((item) => item.platform === updated.platform ? updated : item) } : current);
      setNotice("已按平台规则重新适配当前变体。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "平台变体重新适配失败");
    }
  }
  async function saveStructureDraft() {
    if (!token || !active || !reviewedStructure) return;
    setStructureSaving(true);
    setError("");
    try {
      const saved = await saveFeedStructureDraft(token, active.id, reviewedStructure);
      setActive((current) => current ? { ...current, ...saved } : current);
      setStructureDraft(saved.structure);
      setStructureDirty(false);
      setNotice("结构草稿已保存，批准前不会创建媒体任务。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "结构草稿保存失败，请检查必填字段。");
    } finally {
      setStructureSaving(false);
    }
  }

  async function approveStructure() {
    if (!token || !active || !reviewedStructure) return;
    setStructureSaving(true);
    setError("");
    try {
      if (!structureValid) {
        setError("请补齐标题、受众、痛点、Hook、CTA 和每个镜头字段。");
        return;
      }
      const approved = await approveFeedStructure(token, active.id, reviewedStructure);
      await hydratePackage(approved);
      setStructureDirty(false);
      setNotice("结构已保存并批准，下一步可以生成图片和视频。");
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "结构保存失败，请检查必填内容后重试");
    } finally {
      setStructureSaving(false);
    }
  }

  async function makePackage() {
    if (
      !token ||
      !title.trim() ||
      !brief.trim() ||
      selectedPlatforms.length === 0
    ) {
      setError("请填写标题、商品/选题说明，并至少选择一个平台");
      return;
    }
    const budget = maxCostCny;
    if (mode === "automatic" && (!Number.isFinite(budget) || budget <= 0)) {
      setError("全自动模式需要填写大于 0 的费用上限");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await createFeedPackage(token, {
        title,
        brief,
        goal,
        contentType,
        durationSeconds: duration,
        workflowMode: mode,
        platforms: selectedPlatforms,
        topic: title,
        modelId: model === "auto" ? null : model,
        estimatedCostCny: estimatedCost,
        maxCostCny: mode === "automatic" ? budget : null,
        trendItemId: selectedTrendId,
        referenceImageUrls: referenceImages.map((item) => item.url),
        referenceAssetIds: referenceImages.map((item) => item.assetId),
      });
      await hydratePackage(created);
      setPackages((current) => [created, ...current]);
      setStep(mode === "automatic" ? 3 : 2);
      if (mode === "automatic") setNotice("已按预算启动媒体生成，完成后可进入平台适配和发布。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "内容包创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function askStrategyAgent() {
    if (!token || !strategyPrompt.trim()) return;
    setStrategyBusy(true); setError("");
    try {
      const created = await createFeedPackage(token, {
        title: strategyPrompt.trim().slice(0, 80), brief: strategyPrompt.trim(), goal, contentType, duration,
        workflowMode: "review", platforms: selectedPlatforms, topic: strategyPrompt.trim(), modelId: model === "auto" ? null : model,
        estimatedCostCny: estimatedCost, maxCostCny: null,
      });
      await hydratePackage(created); setPackages((current) => [created, ...current]); setStep(1);
      await generateFeedStructure(token, created.id); setNotice("AI 策略师已生成建议，请在策略步骤中确认和编辑。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI 策略师暂时不可用"); }
    finally { setStrategyBusy(false); }
  }
  async function runFeedAutomation() {
    if (!token || strategyBusy) return;
    const automationPrompt = strategyPrompt.trim() || brief.trim() || title.trim();
    if (!automationPrompt || !selectedPlatforms.length) {
      setError("请填写选题、简短说明并至少选择一个发布平台");
      return;
    }
    automationAbortRef.current?.abort();
    const controller = new AbortController();
    automationAbortRef.current = controller;
    setStrategyBusy(true); setError("");
    try {
      const run = await createFeedAutomation(token, {
        title: title.trim() || automationPrompt.slice(0, 80),
        brief: automationPrompt,
        goal,
        contentType,
        platforms: selectedPlatforms,
        durationSeconds: duration,
        modelId: model === "auto" ? null : model,
        idempotencyKey: `feed-auto:${crypto.randomUUID()}`,
      });
      setAutomationRun(run);
      setNotice("自动化任务已创建，正在生成可编辑内容草稿。");
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            controller.signal.removeEventListener("abort", abortWait);
            resolve();
          }, 2_000);
          const abortWait = () => {
            window.clearTimeout(timeout);
            reject(new DOMException("Automation monitoring stopped", "AbortError"));
          };
          controller.signal.addEventListener("abort", abortWait, { once: true });
        });
        if (controller.signal.aborted) return;
        const status = await fetchFeedAutomation(token, run.id);
        if (controller.signal.aborted) return;
        setAutomationRun(status);
        if (status.status === "failed") throw new Error(status.errorMessage || "Feed 自动化生成失败");
        if (status.status === "draft_ready") {
          const created = await fetchFeedPackage(token, status.packageId);
          await hydratePackage(created);
          setPackages((current) => [created, ...current.filter((item) => item.id !== created.id)]);
          setStep(2);
          setNotice("自动草稿已生成，可以编辑结构和平台版本。");
          return;
        }
      }
      throw new Error("Feed 自动化任务超时");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Feed 自动化任务失败");
    } finally {
      if (automationAbortRef.current === controller) {
        automationAbortRef.current = null;
        setStrategyBusy(false);
      }
    }
  }
  function stopAutomationMonitoring() {
    const controller = automationAbortRef.current;
    automationAbortRef.current = null;
    controller?.abort();
    setStrategyBusy(false);
    setNotice("已停止此页面的状态轮询；服务器端任务可能仍在运行，可刷新状态查看。");
  }

  async function retryAutomation() {
    if (!token || !automationRun) return;
    setStrategyBusy(true); setError("");
    try {
      const next = await retryFeedAutomation(token, automationRun.id);
      setAutomationRun(next);
      setNotice("自动化任务已重新排队。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重试阶段失败");
    } finally {
      setStrategyBusy(false);
    }
  }
  function openCanvas() {
    if (!active || !reviewedStructure) return;
    const platformName = platforms.find(([id]) => id === publishPlatform)?.[1] ?? "抖音";
    const canvasPlatform = FEED_PLATFORMS.find((item) => item === platformName) ?? "抖音";
    const prompt = buildFeedPrompt({
      mode: "feed",
      platform: canvasPlatform,
      goal,
      contentType,
      duration,
      brief: `${brief}\n内容包ID：${active.id}\n已确认标题：${reviewedStructure.title}\n已确认钩子：${reviewedStructure.hook}\n严格执行已确认结构并将资产关联到内容包。`,
    });
    void create({
      prompt,
      videoGenerationPreference: {
        mode: model === "auto" ? "auto" : "manual",
        models: model === "auto" ? [] : [model],
        duration,
      },
    });
  }

  async function generateStructureWithModel() {
    if (!token || !active) return;
    setStructureGenerating(true);
    setError("");
    try {
      await generateFeedStructure(token, active.id);
      setNotice("结构化模型任务已进入队列，稍后刷新内容包即可看到结果。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "结构化模型任务启动失败");
    } finally {
      setStructureGenerating(false);
    }
  }
  async function startMediaRender() {
    if (!token || !active) return;
    if (structureDirty) {
      setError("请先保存当前结构修改，再开始生成媒体");
      return;
    }
    setMediaStarting(true);
    setError("");
    try {
      const rendered = await renderFeedPackage(token, active.id);
      setActive((current) => (current ? { ...current, ...rendered } : current));
      setStep(3);
      setNotice("图片和视频任务已进入队列；已完成资产不会重复生成。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "媒体任务启动失败，请重试");
    } finally {
      setMediaStarting(false);
    }
  }
  async function downloadTimeline() {
    if (!token || !active) return;
    try {
      const blob = await downloadFeedTimeline(token, active.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `feed-${active.id}-timeline.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "时间线下载失败");
    }
  }
  async function downloadManifest() {
    if (!token || !active) return;
    try {
      const blob = await downloadFeedManifest(token, active.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `feed-${active.id}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布包下载失败");
    }
  }
  async function schedulePost() {
    if (scheduleAction) return;
    if (!token || !active || !publishPlatform || !accountId || !scheduledAt) {
      setError("请先选择已绑定账号和计划发布时间");
      return;
    }
    if (!currentVariant) {
      setError("当前平台还没有内容变体，请先刷新内容包详情");
      return;
    }
    setScheduleAction("save");
    setError("");
    setNotice("");
    try {
      const plan = await createFeedSchedule(token, {
        packageId: active.id,
        variantId: currentVariant.id,
        platform: publishPlatform,
        accountId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        publishMode,
        idempotencyKey: `${active.id}:${currentVariant.id}:${publishPlatform}:${accountId}:${new Date(scheduledAt).toISOString()}`,
      });
      if (typeof plan.id === "string") {
        setScheduleDrafts((current) => ({
          ...current,
          [publishPlatform]: { accountId, publishMode, scheduledAt, planId: plan.id as string },
        }));
      }
      setNotice(publishMode === "scan_confirm" ? "任务已进入待确认，确认后才会进入发布队列。" : "排程已保存，到点后按所选发布方式执行。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "排程保存失败");
    } finally {
      setScheduleAction(null);
    }
  }

  async function confirmSchedule(scheduleId: string) {
    if (!token || scheduleAction) return;
    setScheduleAction("confirm");
    try { await actOnFeedSchedule(token, scheduleId, { action: "confirm" }); setNotice("已确认，任务进入待发布状态。"); }
    catch (err) { setError(err instanceof Error ? err.message : "确认失败"); }
    finally { setScheduleAction(null); }
  }
  async function markPublished() {
    const planId = scheduleDrafts[publishPlatform]?.planId;
    if (scheduleAction) return;
    if (!token || !planId || !postUrl.trim()) {
      setError("请先填写公开帖子链接，再标记已发布");
      return;
    }
    setScheduleAction("publish");
    try {
      await actOnFeedSchedule(token, planId, { action: "mark_published", externalUrl: postUrl.trim() });
      setNotice(`${publishPlatform} 已记录为人工发布，公开链接已保存。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "标记发布失败");
    } finally { setScheduleAction(null); }
  }

  async function createDouyinLink(kind: "live" | "profile" | "item") {
    if (!token || publishPlatform !== "douyin") return;
    if (!douyinTarget.trim()) {
      setError(kind === "item" ? "请输入抖音作品 item_id" : "请输入抖音号");
      return;
    }
    setDouyinLinkBusy(kind);
    setError("");
    try {
      const response = await createDouyinJumpLink(token, { kind, value: douyinTarget.trim() });
      setDouyinLinks((current) => ({ ...current, [kind]: response.data.url }));
      setNotice("抖音人工发布跳转链接已生成，打开后仍需你在抖音端确认发布。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "抖音跳转链接生成失败");
    } finally {
      setDouyinLinkBusy(null);
    }
  }
  async function downloadMetricsTemplate() {
    if (!token) return;
    try {
      const blob = await downloadFeedMetricsTemplate(token);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "feed-metrics-template.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV 模板下载失败");
    }
  }
  async function previewMetricsCsv(file: File | undefined) {
    if (!token || !file) return;
    setCsvImporting(true);
    setError("");
    setCsvImportResult(null);
    try {
      const preview = await previewFeedMetricsCsv(token, file);
      setCsvPreview({ records: preview.records, errors: preview.errors });
      setNotice(`CSV 已解析：${preview.records.length} 行有效，${preview.errors.length} 行待修正。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV 解析失败");
    } finally {
      setCsvImporting(false);
    }
  }

  async function confirmMetricsCsvImport() {
    if (!token || !csvPreview?.records.length) return;
    setCsvImporting(true);
    setError("");
    try {
      const result = await importFeedMetrics(token, csvPreview.records);
      setCsvImportResult({
        imported: Number((result as { imported?: number }).imported ?? csvPreview.records.length),
        rejected: Number((result as { rejected?: number }).rejected ?? 0),
        errors: Array.isArray((result as { errors?: Array<{ row: number; message: string }> }).errors)
          ? (result as { errors: Array<{ row: number; message: string }> }).errors
          : [],
      });
      setCsvPreview(null);
      setNotice(`已导入 ${String((result as { imported?: number }).imported ?? csvPreview.records.length)} 行指标。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV 指标导入失败");
    } finally {
      setCsvImporting(false);
    }
  }
  async function recordMetrics() {
    if (!token || !active || !accountAlias.trim() || !postUrl.trim()) {
      setError("请填写账号别名和公开帖子链接");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await saveFeedMetric(token, {
        packageId: active.id,
        planId: scheduleDrafts[publishPlatform]?.planId ?? null,
        variantId: currentVariant?.id ?? null,
        platform: publishPlatform,
        accountAlias,
        postUrl,
        publishedAt: new Date().toISOString(),
        impressions,
        views,
        completions,
        likes,
        comments,
        shares,
        saves,
        clicks,
        leads,
        conversions,
        spendCny: spend,
        revenueCny: revenue,
      });
      const insight = await fetchFeedInsights(token, active.id);
      setInsightView({ summary: insight.summary, recommendations: insight.recommendations });
      setNotice("数据已回流，复盘指标已更新。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "数据保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-5 py-8 sm:px-8 lg:px-12">
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2" aria-label="feed-automation">
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {automationRun?.status === "failed" ? "自动化失败" : automationRun?.status === "draft_ready" ? "策略草稿已就绪" : automationRun ? "正在生成策略草稿" : ""}
          {automationRun?.current_stage ? ` · ${automationStageLabels[automationRun.current_stage] ?? automationRun.current_stage.replaceAll("_", " ")}` : ""}
        </span>
        {automationRun?.status === "failed" && <Button variant="outline" size="sm" onClick={() => void retryAutomation()} disabled={strategyBusy}>重试当前阶段</Button>}
        {strategyBusy && automationRun && <Button variant="outline" size="sm" onClick={stopAutomationMonitoring}>停止监控</Button>}
        <Button variant="outline" size="sm" onClick={() => void runFeedAutomation()} disabled={strategyBusy} aria-busy={strategyBusy}>{strategyBusy ? "生成中" : "自动生成草稿"}</Button>
      </div>
      {step === 1 && selectedPlatforms.length > 0 && <div className="mb-4 flex flex-wrap gap-2" role="region" aria-label="平台草稿状态" aria-live="polite">{selectedPlatforms.map((platform) => { const variant = activeVariants.find((item) => item.platform === platform); const label = platforms.find(([id]) => id === platform)?.[1] ?? platform; const status = variant?.title ? "草稿已就绪" : "等待草稿"; return <span key={platform} aria-label={`${label}：${status}`} className="rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground">{label}：{status}</span>; })}</div>}
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            社媒运营工作台
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            信息流闭环
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            从热点和选题开始，产出可审阅的内容包、平台发布资料与可追踪的复盘数据。首期不自动登录平台发布。
          </p>
        </div>
        <Button variant="outline" onClick={() => void syncTrends()} disabled={syncing || initialLoading}>
          <RefreshCw className={cn("mr-2 size-4", syncing && "animate-spin")} />
          联网刷新热点
        </Button>
        <Button
          variant="outline"
          onClick={() => void refreshAll()}
          disabled={initialLoading || workspaceLoading || trendLoading}
        >
          <RefreshCw className={cn("mr-2 size-4", (initialLoading || workspaceLoading || trendLoading) && "animate-spin")} />
          刷新
        </Button>
      </header>
      <section className="mt-6 rounded-xl border border-border/60 bg-card p-4">
        <div><h2 className="text-sm font-semibold">系统实时热点源</h2><p className="mt-1 text-xs text-muted-foreground">系统每 30 分钟自动同步中文新闻热点，也可手动联网刷新，无需用户配置 RSS。</p></div>
        <div className="mt-3 flex flex-wrap gap-2">
          {sources.length > 0 ? sources.map((source) => <span key={source.id} className="rounded-full border px-3 py-1 text-xs">{source.platform === "google-news" ? "系统中文热点" : source.name} {source.last_error ? "· 同步异常" : source.last_synced_at ? "· 已同步" : "· 等待首次同步"}</span>) : <span className="text-xs text-muted-foreground">正在初始化系统热点源…</span>}
        </div>
      </section>
      <section className="mt-4 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center" aria-label="AI策略师"><div className="min-w-0 flex-1"><p className="text-sm font-medium">AI 策略师</p><p className="mt-1 text-xs text-muted-foreground">直接描述目标，聊天模型会创建内容包并生成策略草稿。</p></div><input value={strategyPrompt} onChange={(event) => setStrategyPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void askStrategyAgent(); }} placeholder="例如：为新品做一条 15 秒抖音种草视频" className="h-10 min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-3 text-sm" /><Button size="sm" onClick={() => void askStrategyAgent()} disabled={strategyBusy || !strategyPrompt.trim()}>{strategyBusy ? "生成中" : "让 AI 策划"}</Button></section>
      <nav
        aria-label="信息流步骤"
        className="mt-8 border-b border-border/60"
      >
        <div className="grid grid-cols-3 gap-1 pb-2 sm:hidden">
          {steps.map((label, index) => (
            <button
              key={`mobile-${label}-${index}`}
              type="button"
              disabled={index > step}
              onClick={() => goToStep(index)}
              aria-current={step === index ? "step" : undefined}
              aria-label={`${index + 1} of ${steps.length}: ${label}`}
              className={cn("min-h-11 rounded-md border px-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-50", step === index ? "border-foreground bg-muted font-medium text-foreground" : "border-border/60 text-muted-foreground")}
            >
              {index + 1}. {label}
            </button>
          ))}
        </div>
        <div className="hidden grid-cols-6 sm:grid">
          {steps.map((label, index) => (
            <button
              key={`${label}-${index}`}
              type="button"
              disabled={index > step}
              onClick={() => goToStep(index)}
              aria-current={step === index ? "step" : undefined}
              aria-label={`${index + 1} of ${steps.length}: ${label}`}
              className={cn(
                "min-h-12 border-b-2 px-3 py-3 text-xs transition-colors disabled:cursor-not-allowed",
                step === index
                  ? "border-foreground font-medium text-foreground"
                  : index < step
                    ? "border-emerald-500/60 text-foreground hover:bg-muted/40"
                    : "border-transparent text-muted-foreground",
              )}
            >
              {index < step ? (
                <Check className="mr-1 inline size-3.5 text-emerald-600" />
              ) : (
                `${index + 1}. `
              )}
              {label}
            </button>
          ))}
        </div>
      </nav>
      {active && (
        <section className="mt-5 grid gap-4 rounded-xl border border-border/60 bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" aria-label="内容包状态摘要">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{active.title}</p>
              <span className="rounded-full border border-border/60 px-2 py-1 text-[11px]">{packageStatusLabels[active.status] ?? active.status}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">当前步骤：{steps[step]} · 下一动作：{packageNextAction(active.status)}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshActivePackage()} disabled={renderRefreshing}>
            <RefreshCw className={cn("mr-2 size-3.5", renderRefreshing && "animate-spin")} />刷新状态
          </Button>
        </section>
      )}
      {error && (
        <div
          role="alert"
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void (active ? refreshActivePackage() : refreshAll())}>
            <RefreshCw className="mr-2 size-3.5" /> 重试
          </Button>
        </div>
      )}
      {partialNotice && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <span>{partialNotice}</span>
          <Button variant="outline" size="sm" onClick={() => void syncTrends()} disabled={syncing}>
            <RefreshCw className="mr-2 size-3.5" /> 重试热点同步
          </Button>
        </div>
      )}
      {initialLoading && (
        <div className="mt-5 rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline size-4 animate-spin" /> 正在加载信息流工作台…
        </div>
      )}
      <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 rounded-2xl border border-border/60 bg-background/50 p-5 sm:p-7">
          {step === 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-medium">热点与选题</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    仅展示从真实 RSS/API 抓取的热点；策划模板不会伪装成热点。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-full sm:w-52">
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索热点标题或摘要"
                      aria-label="搜索热点"
                      className="h-9 w-full rounded-lg border border-border/60 bg-background px-3 pr-9 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    {query ? (
                      <button
                        type="button"
                        aria-label="清除热点搜索"
                        onClick={() => setQuery("")}
                        className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  <StyledSelect
                    value={trendSort}
                    onChange={(value) => {
                      const next = value === "latest" ? "latest" : "heat";
                      setTrendSort(next);
                      void loadTrends({ page: 1, sort: next });
                    }}
                    aria-label="热点排序"
                    options={[{ value: "heat", label: "热度排行" }, { value: "latest", label: "最新发布" }]}
                  />
                  <span className="text-xs text-muted-foreground">可搜索、排序或翻页查看热点</span>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-dashed border-primary/35 bg-primary/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <PenLine className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">不想用热点？可以直接创建选题</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">热点不是必选项。你可以从商品、目标受众或自由主题开始，直接进入内容策略。</p>
                  </div>
                </div>
                <Button
                  type="button"
                  data-testid="feed-custom-topic"
                  className="w-full shrink-0 sm:w-auto"
                  onClick={startCustomTopic}
                >
                  直接创建自定义选题
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              </div>
              <div
                className="mt-5 grid gap-3"
                role="region"
                aria-label="实时热点结果"
                aria-busy={trendLoading}
              >
                {trendLoading && trends.length ? (
                  <p role="status" aria-live="polite" className="sr-only">正在刷新热点…</p>
                ) : null}
                {trendLoading && !trends.length ? (
                  <p role="status" aria-live="polite" className="py-10 text-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 inline size-4 animate-spin" />
                    正在加载热点
                  </p>
                ) : trends.length ? (
                  trends.map((item, index) => (
                    <article key={`${item.id}-${index}`} className="rounded-xl border border-border/60 transition-colors hover:border-foreground/40 hover:bg-muted/30">
                      <button
                        type="button"
                        onClick={() => chooseTrend(item)}
                        className="w-full rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      >
                        <div className="flex justify-between gap-3">
                          <strong className="text-sm">{item.title}</strong>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {item.platform} · 热度 {item.heat ?? "-"}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {item.summary || "暂无摘要，点击后补充商品说明。"}
                        </p>
                      </button>
                      {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer" className="ml-4 mb-4 inline-block text-xs underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">查看原文</a>}
                    </article>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                    <p>暂无匹配的实时热点。</p>
                    <p className="mt-2 text-xs">可清空搜索重试，或直接创建自定义选题，不需要热点也能继续。</p>
                    <Button className="mt-4" variant="outline" onClick={startCustomTopic}>
                      直接创建自定义选题 <ArrowRight className="ml-2 size-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-4">
                <span className="text-xs text-muted-foreground">
                  {trendTotal ? `第 ${trendPage} / ${trendTotalPages} 页 · 共 ${trendTotal} 条` : "暂无匹配热点"}
                </span>
                <div className="flex items-center gap-2">
                  <Button aria-label="上一页热点" variant="outline" size="sm" disabled={trendLoading || trendPage <= 1} onClick={() => void loadTrends({ page: trendPage - 1 })}>上一页</Button>
                  <Button aria-label="下一页热点" variant="outline" size="sm" disabled={trendLoading || trendPage >= trendTotalPages} onClick={() => void loadTrends({ page: trendPage + 1 })}>下一页</Button>
                </div>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <section className="mb-5 overflow-hidden rounded-xl border border-border/60 bg-card" aria-label="AI 策略师"><div className="h-16 bg-muted/30"><Strands listening energy={0.35} /></div><div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="text-base font-medium">AI 策略师</h2><p className="mt-1 text-xs text-muted-foreground">根据当前选题生成可编辑的策略建议，逐项确认后写入内容包。</p></div><Button variant="outline" size="sm" onClick={() => setNotice("策略建议已生成，请逐项采纳")}>生成策略建议</Button></div><div className="grid gap-2 border-t border-border/50 p-4 text-xs sm:grid-cols-2"><Suggestion label="目标" value={String(goal)} /><Suggestion label="内容类型" value={String(contentType)} /><Suggestion label="平台" value={selectedPlatforms.join("、") || "尚未选择"} /><Suggestion label="时长" value={`${duration} 秒`} /></div></section>
              <h2 className="text-base font-medium">内容策略</h2>
              <div className="mt-5 grid gap-5">
                <label className="text-xs font-medium">
                  选题标题
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="例如：通勤人群如何解决雨天收纳"
                    className="mt-2 h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none focus:border-foreground/50"
                  />
                </label>
                <label className="text-xs font-medium">
                  商品与受众说明
                  <textarea
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder="说清商品、卖点、受众和不能虚构的参数"
                    className="mt-2 min-h-32 w-full resize-y rounded-xl border border-border/60 bg-background px-3 py-3 text-sm leading-6 outline-none focus:border-foreground/50"
                  />
                </label>
                <div className="rounded-xl border border-border/60 p-4">
                  <label className="text-xs font-medium">
                    商品参考图（可选，最多 8 张）
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      multiple
                      disabled={referenceUploading}
                      onChange={(event) => void uploadReferenceImages(event.target.files)}
                      className="mt-2 block w-full text-xs text-muted-foreground"
                    />
                  </label>
                  <p className="mt-2 text-xs text-muted-foreground">参考图会同时传给图片和视频任务，用于保持商品外观、颜色、材质和标识一致。</p>
                  {referenceImages.length > 0 && (
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {referenceImages.map((item) => <img key={item.assetId} src={item.url} alt="商品参考图" className="aspect-square rounded-lg border border-border/60 object-cover" />)}
                    </div>
                  )}
                </div>                <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-xs">
                  {selectedTrendId ? (
                    <p className="text-emerald-700 dark:text-emerald-300">
                      已关联真实热点。创建后会写入内容包，后续复盘可以回溯来源。
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      当前为自定义选题，不依赖热点来源；你可以直接按商品、受众和目标继续。
                    </p>
                  )}
                </div>
                <div>
                  <span className="text-xs font-medium">平台（可多选）</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {platforms.map(([id, label], index) => (
                      <button
                        key={`${id}-${index}`}
                        type="button"
                        onClick={() => togglePlatform(id)}
                        aria-pressed={selectedPlatforms.includes(id)}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-xs",
                          selectedPlatforms.includes(id)
                            ? "border-foreground bg-foreground text-background"
                            : "border-border/60 text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-medium">
                    业务目标
                    <StyledSelect
                      value={goal}
                      onChange={(value) => setGoal(value as FeedGoal)}
                      options={FEED_GOALS.map(([value, note]) => ({
                        value,
                        label: value,
                        note,
                      }))}
                    />
                  </label>
                  <label className="text-xs font-medium">
                    内容类型
                    <StyledSelect
                      value={contentType}
                      onChange={(value) =>
                        setContentType(value as FeedContentType)
                      }
                      options={FEED_CONTENT_TYPES.map(([value, note]) => ({
                        value,
                        label: value,
                        note,
                      }))}
                    />
                  </label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-medium">
                    视频模型
                    <StyledSelect
                      value={model}
                      onChange={setModel}
                      aria-label="视频模型"
                      options={[
                        {
                          value: "auto",
                          label: "智能路由",
                          note: "自动选择健康且兼容的模型",
                        },
                        ...models.map((item) => ({
                          value: item.id,
                          label: item.displayName,
                          note: `${item.limits?.maxResolution ?? "分辨率待定"} · ${getModelPricingLabel(item, "video")}`,
                        })),
                      ]}
                    />
                  </label>
                  <div>
                    <span className="text-xs font-medium">成片时长</span>
                    <div className="mt-2 flex min-h-11 flex-wrap gap-2">
                    {availableDurations.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setDuration(item)}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-xs",
                          duration === item
                            ? "border-foreground bg-foreground text-background"
                            : "border-border/60 text-muted-foreground",
                        )}
                      >
                        {item} 秒
                      </button>
                    ))}
                    </div>
                  </div>
                </div>
                <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {estimated}
                </p>
                <fieldset>
                  <legend className="text-xs font-medium">生成模式</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label
                      className={cn(
                        "rounded-xl border p-3 text-xs",
                        mode === "review" && "border-foreground bg-muted/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="mode"
                        checked={mode === "review"}
                        onChange={() => setMode("review")}
                        className="mr-2"
                      />
                      先审阅结构，再生成媒体
                    </label>
                    <label
                      className={cn(
                        "rounded-xl border p-3 text-xs",
                        mode === "automatic" && "border-foreground bg-muted/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="mode"
                        checked={mode === "automatic"}
                        onChange={() => setMode("automatic")}
                        className="mr-2"
                      />
                      确认预算后全自动
                    </label>
                  </div>
                </fieldset>                {mode === "automatic" && (
                  <label className="block text-xs font-medium">
                    本次最高预算（元）
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={maxCostCny}
                      onChange={(event) => setMaxCostCny(Math.max(0.01, Number(event.target.value) || 0.01))}
                      className="mt-2 h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm"
                    />
                    <span className="mt-1 block font-normal text-muted-foreground">超过此金额不会自动提交生成。</span>
                  </label>
                )}                <Button
                  size="lg"
                  onClick={() => void makePackage()}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 size-4" />
                  )}
                  生成内容包
                </Button>
              </div>
            </>
          )}
          {step === 2 && active && reviewedStructure && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-medium">脚本与镜头审阅</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    这里的修改会真正 PATCH 回内容包；批准前不会启动媒体任务。
                  </p>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700 dark:text-emerald-300">
                  {active.status}
                </span>
              </div>
              <div className="mt-5 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    ["标题", "title", reviewedStructure.title],
                    ["前三秒钩子", "hook", reviewedStructure.hook],
                    ["目标受众", "audience", reviewedStructure.audience],
                    ["核心痛点", "painPoint", reviewedStructure.painPoint],
                    ["内容角度", "angle", reviewedStructure.angle],
                    ["传播假设", "hypothesis", reviewedStructure.hypothesis],
                    ["单一 CTA", "cta", reviewedStructure.cta],
                  ].map(([label, key, value]) => (
                    <label key={key} className="text-xs font-medium">
                      {label}
                      <input
                        value={value}
                        onChange={(event) => updateStructure(key as keyof FeedStructure, event.target.value as never)}
                        className="mt-2 h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm"
                      />
                    </label>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-medium">
                    可信证据点（每行一条）
                    <textarea
                      value={reviewedStructure.evidence.join("\n")}
                      onChange={(event) => updateStructure("evidence", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))}
                      className="mt-2 min-h-24 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm leading-6"
                    />
                  </label>
                  <label className="text-xs font-medium">
                    风险提示（每行一条）
                    <textarea
                      value={reviewedStructure.riskNotes.join("\n")}
                      onChange={(event) => updateStructure("riskNotes", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))}
                      className="mt-2 min-h-24 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm leading-6"
                    />
                  </label>
                </div>
                <div>
                  <p className="text-xs font-medium">镜头与字幕</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {reviewedStructure.shots.map((shot) => (
                      <div key={shot.id} className="rounded-xl border border-border/60 p-4">
                        <p className="text-xs font-medium">{shot.startSecond}–{shot.endSecond} 秒</p>
                        <label className="mt-3 block text-xs font-medium">
                          画面描述
                          <textarea value={shot.visual} onChange={(event) => updateShot(shot.id, "visual", event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm" />
                        </label>
                        <label className="mt-3 block text-xs font-medium">
                          口播
                          <textarea value={shot.voiceover} onChange={(event) => updateShot(shot.id, "voiceover", event.target.value)} className="mt-2 min-h-16 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm" />
                        </label>
                        <label className="mt-3 block text-xs font-medium">
                          字幕
                          <input value={shot.subtitle} onChange={(event) => updateShot(shot.id, "subtitle", event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm" />
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-xs leading-6">
                  <strong>费用预估：</strong>{estimated}
                  <span className="ml-3 text-muted-foreground">媒体生成仍遵守一张首帧和一条指定时长视频。</span>
                </div>
              </div>
<div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => void generateStructureWithModel()} disabled={structureGenerating || !active}>{structureGenerating ? "提交中…" : "用模型生成/补齐结构"}</Button></div>
               <div className="mt-4 flex flex-wrap items-center gap-2">
                 <Button variant="outline" onClick={() => void saveStructureDraft()} disabled={structureSaving || !structureDirty || !structureValid}>
                   {structureSaving ? "保存中..." : "保存结构草稿"}
                 </Button>
                 {structureDirty && <span data-testid="feed-structure-dirty" role="status" aria-live="polite" aria-atomic="true" className="text-xs text-amber-700 dark:text-amber-300">有未保存修改；离开页面前会提示保存</span>}
               </div>
               <div className="mt-5 flex flex-wrap gap-2">
                <Button data-testid="feed-approve-structure" onClick={() => void approveStructure()} disabled={structureSaving || !structureValid}>
                  {structureSaving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}
                  {structureDirty ? "保存并批准结构" : "批准当前结构"}
                </Button>
                <Button variant="outline" onClick={() => void openCanvas()} disabled={creating}>
                  <PenLine className="mr-2 size-4" /> 在画布中查看
                </Button>
                <Button variant="outline" onClick={() => goToStep(5)}>
                  <Send className="mr-2 size-4" /> 发布与复盘
                </Button>
              </div>
            </>
          )}
          {step === 3 && active && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-medium">图片、视频与费用确认</h2>
                  <p className="mt-1 text-xs text-muted-foreground">媒体任务按内容包幂等执行，已完成资产不会重复生成。</p>
                </div>
                <span className="rounded-full bg-muted px-3 py-1 text-xs">当前状态：{active.status}</span>
              </div>
              <div className="mt-5 rounded-xl border border-border/60 bg-muted/20 p-4 text-sm leading-6">
                <p>{active.status === "rendering" ? "媒体任务正在后台执行，请稍后刷新内容包状态。" : "确认结构后才会生成媒体。"}</p>
                <p className="mt-2 text-xs text-muted-foreground">提示：首期导出的是时间线工程，尚未合成最终配音和 BGM 成片。</p>
              </div>
               {active.renderJobs?.length ? (
                 <div className="mt-5 space-y-2">
                   {active.renderJobs.map((job) => (
                     <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs">
                       <span>{job.job_type === "image_generation" ? "图片" : "视频"} · {job.stage ?? job.status}</span>
                       <span className={cn(job.status === "failed" || job.status === "dead_letter" ? "text-red-700 dark:text-red-300" : "text-muted-foreground")}>
                         {job.status === "failed" || job.status === "dead_letter" ? (job.error_message ?? "任务失败") : `${job.progress ?? 0}%`}
                       </span>
                     </div>
                   ))}
                 </div>
               ) : null}
               <div className="mt-5 flex flex-wrap gap-2">
                 <Button onClick={() => void startMediaRender()} disabled={mediaStarting || active.status === "rendering" || active.status === "ready"}>
                  {mediaStarting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
                  {active.status === "rendering" ? "正在生成" : "开始生成图片与视频"}
                </Button>
                <Button variant="outline" onClick={() => void openCanvas()} disabled={creating}>
                  <PenLine className="mr-2 size-4" /> 在画布中查看
                </Button>
                <Button variant="outline" onClick={() => goToStep(4)}>
                  <ArrowRight className="mr-2 size-4" /> 查看平台适配
                </Button>
              </div>
            </>
          )}
          {step === 4 && active && (
            <>
              <h2 className="text-base font-medium">平台适配与时间线</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">同一内容包会保留每个平台的独立变体。排程时必须显式选择平台，不会静默只使用第一个平台。</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {activeVariants.length ? activeVariants.map((variant) => {
                  const editing = editingVariantId === variant.id && variantDraft;
                  const missingFields = [
                    !variant.title.trim() && "标题",
                    !variant.body.trim() && "正文",
                    !variant.cover_text.trim() && "封面文案",
                  ].filter(Boolean) as string[];
                  return (
                    <div key={variant.id} className="rounded-xl border border-border/60 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium">{platforms.find(([id]) => id === variant.platform)?.[1] ?? variant.platform}</p>
                        {missingFields.length > 0 && <span className="text-[11px] text-amber-700 dark:text-amber-300">缺少：{missingFields.join("、")}</span>}
                        <span className="text-[11px] text-muted-foreground">{variant.locked ? "已锁定" : "可编辑"}</span>
                      </div>
                      {editing ? (
                        <div className="mt-3 space-y-2">
                          <input value={variantDraft.title} onChange={(event) => setVariantDraft({ ...variantDraft, title: event.target.value })} className="h-9 w-full rounded-lg border border-border/60 bg-background px-2 text-sm" />
                          <textarea value={variantDraft.body} onChange={(event) => setVariantDraft({ ...variantDraft, body: event.target.value })} className="min-h-28 w-full rounded-lg border border-border/60 bg-background px-2 py-2 text-xs leading-5" />
                          <input value={variantDraft.hashtags} onChange={(event) => setVariantDraft({ ...variantDraft, hashtags: event.target.value })} placeholder="标签，用逗号分隔" className="h-9 w-full rounded-lg border border-border/60 bg-background px-2 text-xs" />
                          <input value={variantDraft.coverText} onChange={(event) => setVariantDraft({ ...variantDraft, coverText: event.target.value })} placeholder="封面文案" className="h-9 w-full rounded-lg border border-border/60 bg-background px-2 text-xs" />
                          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={variantDraft.locked} onChange={(event) => setVariantDraft({ ...variantDraft, locked: event.target.checked })} />保存后锁定此版本</label>
                          <div className="flex gap-2"><Button size="sm" onClick={() => void saveVariantEdit()}>保存</Button><Button size="sm" variant="outline" onClick={() => { setEditingVariantId(null); setVariantDraft(null); }}>取消</Button></div>
                        </div>
                      ) : (
                        <>
                          <p className="mt-2 text-sm font-medium">{variant.title}</p>
                          <p className="mt-2 line-clamp-4 text-xs leading-5 text-muted-foreground">{variant.body}</p>
                          <p className="mt-2 text-xs text-muted-foreground">标签：{variant.hashtags.length ? variant.hashtags.map((tag) => `#${tag}`).join(" ") : "未设置"}</p>
                          <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => beginVariantEdit(variant)} disabled={Boolean(variant.locked)}>编辑</Button><Button size="sm" variant="outline" onClick={() => void readaptVariant(variant.id)} disabled={Boolean(variant.locked)}>重新适配</Button><Button size="sm" variant="ghost" onClick={() => beginVariantEdit({ ...variant, locked: false })}>{variant.locked ? "查看" : "锁定/编辑"}</Button></div>
                        </>
                      )}
                    </div>
                  );
                }) : (
                  <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground sm:col-span-2">平台变体尚未返回，点击右上角刷新或重新打开内容包。</div>
                )}
              </div>              <div className="mt-5 rounded-xl border border-border/60 bg-muted/20 p-4 text-xs leading-6">
                时间线包含视频、首帧、字幕和旁白/BGM 占位轨。下载后可在画布中继续编辑；它不是最终 MP4。
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void downloadTimeline()} disabled={!active}><Download className="mr-2 size-4" /> 下载时间线 JSON</Button>
                <Button onClick={() => goToStep(5)}><ArrowRight className="mr-2 size-4" /> 进入排程与发布</Button>
              </div>
            </>
          )}
          {step === 5 && (
            <>
              <h2 className="text-base font-medium">发布与复盘</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                下载发布资料并人工发布。发布后录入单条帖子数据，系统计算完播率、互动率、CTR、转化率、CPA
                与 ROAS。
              </p>
              {notice && (
                <p
                  role="status"
                  className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
                >
                  {notice}
                </p>
              )}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Button
                  variant="outline"
                  onClick={() => void downloadTimeline()}
                  disabled={!active}
                >
                  <Download className="mr-2 size-4" />
                  下载时间线 JSON
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void downloadManifest()}
                  disabled={!active}
                >
                  <Download className="mr-2 size-4" />
                  下载平台发布包
                </Button>
              </div>
              <div className="mt-6 grid gap-4 rounded-xl border border-border/60 p-5">
                <div>
                  <h3 className="text-sm font-medium">账号与发布方式</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">每个已选择平台都要单独选择变体、账号和时间。当前平台不会自动代表其他平台排程。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedPlatforms.map((id) => {
                    const label = platforms.find(([platformId]) => platformId === id)?.[1] ?? id;
                    const scheduled = Boolean(scheduleDrafts[id]?.planId);
                    return (
                      <button
                        key={id}
                        type="button"
                        data-testid={`feed-platform-${id}`}
                        aria-pressed={publishPlatform === id}
                        onClick={() => selectPublishPlatform(id)}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-xs",
                          publishPlatform === id ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground",
                        )}
                      >
                        {label}{scheduled ? " · 已排程" : " · 待排程"}
                      </button>
                    );
                  })}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium">
                    当前平台变体
                    <div className="mt-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs">
                      {currentVariant ? `${currentVariant.title} · ${currentVariant.body.slice(0, 80)}` : "当前平台没有可用变体，请刷新内容包详情"}
                    </div>
                  </label>
                  <label className="text-xs font-medium">
                    发布方式
                    <StyledSelect
                      value={publishMode}
                      onChange={(value) => { setPublishMode(value as PublishingAccount["connection_mode"]); setAccountId(""); }}
                      aria-label="发布方式"
                      options={[
                        { value: "scan_confirm", label: "确认后发布", note: "默认安全模式，用户确认后进入队列" },
                        { value: "deep_link", label: "打开平台发布", note: "下载素材并前往平台手工发布" },
                        { value: "oauth_api", label: "官方 OAuth", note: "仅平台能力审核通过后可用" },
                        { value: "extension", label: "本机扩展", note: "登录态只保留在用户电脑" },
                      ]}
                    />
                  </label>
                  <label className="text-xs font-medium">
                    已绑定账号
                    <StyledSelect
                      value={accountId}
                      onChange={selectAccount}
                      aria-label="已绑定账号"
                      options={[
                        { value: "", label: "请选择账号", note: "账号按当前用户隔离" },
                        ...accounts.filter((item) => item.status === "active" && item.platform === publishPlatform && item.connection_mode === publishMode).map((item) => ({ value: item.id, label: item.alias, note: `${platforms.find(([id]) => id === item.platform)?.[1] ?? item.platform} · ${item.connection_mode}` })),
                      ]}
                    />
                  </label>
                  <label className="text-xs font-medium">
                    计划发布时间
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(event) => setScheduledAt(event.target.value)}
                      className="mt-2 h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm"
                    />
                  </label>
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">需要新增或解绑账号，请前往“工作区设置 → 个人资料 → 社交媒体账号”。没有可选账号时，先去设置完成绑定。</p>
                {!accounts.some((item) => item.platform === publishPlatform && item.connection_mode === publishMode && item.status === "active") && (
                  <a href="/settings" className="text-xs text-primary underline underline-offset-2 sm:col-span-2">前往工作区设置绑定当前平台账号</a>
                )}
                <Button
                  variant="outline"
                  onClick={() => void schedulePost()}
                  disabled={busy || scheduleAction !== null || !active || !currentVariant}
                  aria-busy={scheduleAction === "save"}
                >
                  {scheduleAction === "save" ? "保存中…" : "保存排程"}
                </Button>
                {publishPlatform === "douyin" && (
                  <div className="sm:col-span-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><p className="text-xs font-medium">抖音人工发布入口</p><p className="mt-1 text-[11px] text-muted-foreground">生成视频、主页或直播间跳转链接，打开后仍需在抖音端确认。</p></div>
                      <span className="text-[11px] text-amber-700 dark:text-amber-300">人工确认</span>
                    </div>
                    <input value={douyinTarget} onChange={(event) => setDouyinTarget(event.target.value)} placeholder="输入抖音号，或视频 item_id" className="mt-3 h-9 w-full rounded-lg border border-border/60 bg-background px-3 text-xs" />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(["item", "profile", "live"] as const).map((kind) => {
                        const label = kind === "item" ? "打开视频" : kind === "profile" ? "打开主页" : "打开直播间";
                        return <div key={kind} className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => void createDouyinLink(kind)} disabled={douyinLinkBusy !== null}>{douyinLinkBusy === kind ? "生成中..." : label}</Button>{douyinLinks[kind] && <a href={douyinLinks[kind]} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary underline underline-offset-2">打开链接</a>}</div>;
                      })}
                    </div>
                  </div>
                )}
                {scheduleDrafts[publishPlatform]?.planId && publishMode === "scan_confirm" && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="text-xs text-amber-800 dark:text-amber-200">此任务尚未发布，需要当前账号所有者确认。</p>
                    <Button size="sm" onClick={() => void confirmSchedule(scheduleDrafts[publishPlatform]!.planId)} disabled={scheduleAction !== null} aria-busy={scheduleAction === "confirm"}>
                      {scheduleAction === "confirm" ? "确认中…" : "确认进入发布队列"}
                    </Button>
                  </div>
                )}
                {scheduleDrafts[publishPlatform]?.planId && (
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-5">
                    <p className="font-medium">人工发布检查清单 · {platforms.find(([id]) => id === publishPlatform)?.[1] ?? publishPlatform}</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                      <li>下载平台发布包，使用当前平台的标题、正文、标签和封面文案。</li>
                      <li>在平台客户端或创作者后台人工发布，不要把时间线 JSON 当作最终 MP4。</li>
                      <li>发布完成后粘贴公开帖子链接，再点击“标记已发布”。</li>
                    </ol>
                    <Button className="mt-3" size="sm" variant="outline" onClick={() => void markPublished()} disabled={!postUrl.trim() || scheduleAction !== null} aria-busy={scheduleAction === "publish"}>
                      {scheduleAction === "publish" ? "保存中…" : "标记已发布并保存链接"}
                    </Button>
                  </div>
                )}
              </div>
              <div className="mt-4 grid gap-4 rounded-xl border border-border/60 p-5">
                <h3 className="text-sm font-medium">帖子数据回流</h3>
                <label className="text-xs font-medium">
                  公开帖子链接
                  <input
                    type="url"
                    value={postUrl}
                    onChange={(event) => setPostUrl(event.target.value)}
                    placeholder="https://..."
                    className="mt-2 h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["曝光", impressions, setImpressions],
                    ["播放", views, setViews],
                    ["完播", completions, setCompletions],
                    ["点赞", likes, setLikes],
                    ["评论", comments, setComments],
                    ["分享", shares, setShares],
                    ["收藏", saves, setSaves],
                    ["点击", clicks, setClicks],
                    ["线索", leads, setLeads],
                    ["转化", conversions, setConversions],
                    ["成本 ¥", spend, setSpend],
                    ["收入 ¥", revenue, setRevenue],
                                    ].map(([label, value, setter]) => (
                    <label key={String(label)} className="text-xs font-medium">
                      {String(label)}
                      <input
                        type="number"
                        min="0"
                        value={Number(value)}
                        onChange={(event) =>
                          (setter as (value: number) => void)(
                            Math.max(0, Number(event.target.value)),
                          )
                        }
                        className="mt-2 h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm"
                      />
                    </label>
                  ))}
                </div>
                <Button
                  onClick={() => void recordMetrics()}
                  disabled={busy || !active}
                >
                  保存数据并复盘
                </Button>
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
                  <label className="font-medium">
                    批量导入 CSV 指标 <button type="button" className="ml-2 underline underline-offset-2" onClick={() => void downloadMetricsTemplate()}>下载模板</button>
                    <input type="file" accept=".csv,text/csv" disabled={csvImporting} onChange={(event) => void previewMetricsCsv(event.target.files?.[0])} className="mt-2 block w-full text-xs text-muted-foreground" />
                  </label>
                  {csvPreview && (
                    <div className="mt-3 space-y-2">
                      <p>预览：{csvPreview.records.length} 行有效，{csvPreview.errors.length} 行错误。</p>
                      {csvPreview.errors.length > 0 && <ul className="list-disc pl-4 text-amber-700">{csvPreview.errors.slice(0, 5).map((item) => <li key={`${item.row}-${item.message}`}>第 {item.row} 行：{item.message}</li>)}</ul>}
                      <Button size="sm" variant="outline" onClick={() => void confirmMetricsCsvImport()} disabled={csvImporting || !csvPreview.records.length}>导入有效行</Button>
                    </div>
                  )}
                  {csvImportResult && (
                    <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                      <p>已导入 {csvImportResult.imported} 行，拒绝 {csvImportResult.rejected} 行。</p>
                      {csvImportResult.errors.length > 0 && <ul className="mt-2 list-disc pl-4 text-amber-700">{csvImportResult.errors.slice(0, 5).map((item) => <li key={`${item.row}-${item.message}`}>第 {item.row} 行：{item.message}</li>)}</ul>}
                    </div>
                  )}
                </div>                {insightView && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-xs leading-5">
                    <p className="font-medium">本轮复盘建议</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                      {insightView.recommendations.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <aside className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-foreground/[0.03] p-5">
            <h2 className="text-sm font-medium">内容包状态</h2>
            <div className="mt-4 space-y-3">
              {steps.map((label, index) => (
                <div key={`${label}-${index}`} className="flex items-center gap-3 text-xs">
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-full border",
                      index <= step
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {index < step ? <Check className="size-3.5" /> : index + 1}
                  </span>
                  <span
                    className={
                      index <= step
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background p-5">
            <h2 className="text-sm font-medium">最近内容包</h2>
            {packages.length ? (
              <div className="mt-3 space-y-2">
                {packages.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void openPackage(item)}
                    className="w-full rounded-lg border border-border/60 p-3 text-left text-xs hover:bg-muted/30"
                  >
                    <span className="block truncate font-medium">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-muted-foreground">
                      {item.status} · {item.duration_seconds} 秒
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                创建后会出现在这里。
              </p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
