"use client";

import { useCredits } from "@/hooks/use-credits";
import { useAuth } from "@/lib/auth-context";
import { type ImageModelInfo, fetchImageModels, uploadFile } from "@/lib/server-api";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Eye,
  EyeOff,
  History,
  Image as ImageIcon,
  Sparkles,
  Wallet,
  Zap,
  X,
} from "lucide-react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORIES, RATIOS, SCENES } from "./constants";
import { StyledSelect } from "@/components/ui/styled-select";
import { getModelPricingLabel } from "@/lib/model-pricing";
import { EcomImagePreviewDialog } from "@/components/ecom-image-preview-dialog";

const MAX_REFERENCE_IMAGES = 10;
const MAX_REFERENCE_BYTES = 25 * 1024 * 1024;

type ReferenceAsset = {
  id: string;
  previewUrl: string;
  uploadedUrl: string | null;
  uploading: boolean;
};

const GENERATION_MODES = [
  { id: "hero", label: "商品主图", note: "单主体、聚焦转化", ratio: "1:1", scene: "01-hero-image" },
  { id: "scene", label: "场景图", note: "自然实拍感", ratio: "4:5", scene: "02-lifestyle-scene" },
  { id: "detail-poster", label: "详情海报", note: "丰富分区与卖点", ratio: "2:3", scene: "11-infographic" },
  { id: "social", label: "种草图", note: "真实生活化表达", ratio: "3:4", scene: "06-social-media" },
  { id: "retouch", label: "原图精修", note: "保留构图与商品", ratio: "1:1", scene: "04-detail-macro" },
] as const;

const FIDELITY_LEVELS = [
  { id: "strict", label: "严格保真", note: "不重绘商品与包装" },
  { id: "balanced", label: "平衡", note: "允许改变视角和光线" },
  { id: "creative", label: "自由创作", note: "允许更强视觉改编" },
] as const;

export default function EcomImagesPage() {
  const { session } = useAuth();
  const { balance: creditsAvailable } = useCredits();
  const [query, setQuery] = useState("");
  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(
    new Set(["11-infographic"]),
  );
  const [productName, setProductName] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>("2:3");
  const [referenceImages, setReferenceImages] = useState<ReferenceAsset[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatedUrls, setGeneratedUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [models, setModels] = useState<ImageModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [imagesPerScene, setImagesPerScene] = useState(1);
  const [generationMode, setGenerationMode] = useState<(typeof GENERATION_MODES)[number]["id"]>("detail-poster");
  const [fidelity, setFidelity] = useState<(typeof FIDELITY_LEVELS)[number]["id"]>("strict");
  const [routing, setRouting] = useState<{ requestedModel: string; selectedModel: string; fallback: boolean } | null>(null);
  const [promptPreview, setPromptPreview] = useState<Array<{ sceneId: string; text: string; ratio: string }> | null>(null);
  const [previewingPrompt, setPreviewingPrompt] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  const compatibleModels = useMemo(
    () =>
      referenceImages.length > 0
        ? models.filter((item) => item.capabilities?.imageToImage)
        : models,
    [models, referenceImages.length],
  );

  useEffect(() => {
    if (referenceImages.length === 0 || compatibleModels.length === 0) return;
    if (compatibleModels.some((item) => item.id === selectedModel)) return;
    const preferred = [
      "gpt-image-2.5-4k",
      "gpt-image-2.5-2k",
      "gpt-image-2.5-1k",
      "gpt-image-2",
      "gpt-image-2-2k",
      "gpt-image-2-1k",
      "black-forest-labs/flux-kontext-max",
      "black-forest-labs/flux-kontext-pro",
    ].find((id) => compatibleModels.some((item) => item.id === id));
    setSelectedModel(preferred ?? compatibleModels[0]!.id);
  }, [compatibleModels, referenceImages.length, selectedModel]);

  const uploadReferences = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const token = session?.access_token;
      if (!token) {
        setError("请先登录后再上传参考图");
        return;
      }
      const available = MAX_REFERENCE_IMAGES - referenceImages.length;
      const accepted = files.slice(0, available);
      const invalid = accepted.find(
        (file) => !file.type.startsWith("image/") || file.size > MAX_REFERENCE_BYTES,
      );
      if (invalid) {
        setError(
          !invalid.type.startsWith("image/")
            ? `${invalid.name} 不是有效图片`
            : `${invalid.name} 超过 25MB`,
        );
        return;
      }
      if (files.length > available) {
        setError(`参考图最多 ${MAX_REFERENCE_IMAGES} 张，已忽略多余文件`);
      } else {
        setError(null);
      }
      const pending = accepted.map((file) => ({
        id: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
        uploadedUrl: null,
        uploading: true,
        file,
      }));
      setReferenceImages((current) => [...current, ...pending.map(({ file: _, ...item }) => item)]);
      await Promise.all(
        pending.map(async ({ file, ...asset }) => {
          try {
            const uploaded = await uploadFile(token, file);
            setReferenceImages((current) =>
              current.map((item) =>
                item.id === asset.id
                  ? { ...item, uploadedUrl: uploaded.url, uploading: false }
                  : item,
              ),
            );
          } catch (uploadError) {
            URL.revokeObjectURL(asset.previewUrl);
            setReferenceImages((current) => current.filter((item) => item.id !== asset.id));
            setError(uploadError instanceof Error ? uploadError.message : "参考图上传失败");
          }
        }),
      );
    },
    [referenceImages.length, session?.access_token],
  );

  const removeReference = useCallback((id: string) => {
    setReferenceImages((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const moveReference = useCallback((index: number, offset: -1 | 1) => {
    setReferenceImages((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }, []);

  const makePrimary = useCallback((index: number) => {
    setReferenceImages((current) => {
      if (index <= 0 || index >= current.length) return current;
      const next = [...current];
      const [selected] = next.splice(index, 1);
      return selected ? [selected, ...next] : current;
    });
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    void fetchImageModels()
      .then(({ models: available, defaultModel }) => {
        const usable = available.filter((model) => model.accessible !== false);
        setModels(usable);
        setSelectedModel((current) => current || usable[0]?.id || defaultModel || "black-forest-labs/flux-kontext-pro");
      })
      .catch(() => setModels([]));
  }, []);

  // Derived state: credit cost + whether user can afford
  const model = models.find((item) => item.id === selectedModel);
  const creditsPerImage = model?.creditCost ?? 10;
  const imageCount = selectedScenes.size * imagesPerScene;
  const creditsNeeded = imageCount * creditsPerImage;
  const creditsLabel = creditsNeeded.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const canAfford = creditsAvailable >= creditsNeeded;
  const previewRatioClasses: Record<(typeof RATIOS)[number], string> = {
    "1:1": "aspect-square",
    "3:2": "aspect-[3/2]",
    "2:3": "aspect-[2/3]",
    "4:3": "aspect-[4/3]",
    "3:4": "aspect-[3/4]",
    "4:5": "aspect-[4/5]",
    "16:9": "aspect-video",
    "9:16": "aspect-[9/16]",
  };

  // Pick up "regenerate" prefill from history page on mount.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("ecom-regenerate-prefill");
      if (!raw) return;
      const data = JSON.parse(raw) as {
        productName: string;
        productDescription: string;
        sceneIds: string[];
        ratio: (typeof RATIOS)[number];
      };
      if (data.productName) setProductName(data.productName);
      if (data.productDescription) setProductDesc(data.productDescription);
      if (data.sceneIds?.length) setSelectedScenes(new Set(data.sceneIds));
      if (data.ratio) setRatio(data.ratio);
      sessionStorage.removeItem("ecom-regenerate-prefill");
    } catch {
      /* ignore */
    }
  }, []);

  const filteredScenes = SCENES.filter(
    (s) =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.nameZh.includes(query) ||
      s.id.includes(query),
  );

  const toggleScene = useCallback((id: string) => {
    setSelectedScenes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!productName || selectedScenes.size === 0) return;
    setGenerating(true);
    setError(null);
    setGeneratedUrls([]);
    setRouting(null);
    try {
      const token = session?.access_token;
      if (!token) {
        throw new Error("请先登录后再生成");
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };

      // 1. Create job
      const createRes = await fetch("/api/ecom/jobs", {
        method: "POST",
        headers,
        body: JSON.stringify({
          productName,
          productDescription: productDesc || undefined,
          customPrompt: customPrompt.trim() || undefined,
          mode: generationMode,
          fidelity,
          sceneIds: Array.from(selectedScenes),
          quantity: imagesPerScene,
          ratio,
          referenceImageUrls: referenceImages
            .map((image) => image.uploadedUrl)
            .filter((url): url is string => Boolean(url)),
          model: selectedModel || undefined,
        }),
      });
      if (!createRes.ok) {
        const err = (await createRes.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(err.error?.message ?? "创建任务失败");
      }
      const created = (await createRes.json()) as {
        job: { id: string; status: string };
        routing?: { requestedModel: string; selectedModel: string; fallback: boolean };
      };
      const { job } = created;
      setRouting(created.routing ?? null);

      // 2. Poll job until complete
      const poll = async (): Promise<string[]> => {
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const res = await fetch(`/api/ecom/jobs/${job.id}`, {
            cache: "no-store",
            headers,
          });
          if (!res.ok) continue;
          const data = (await res.json()) as {
            job: {
              status: string;
              errorMessage?: string | null;
              outputs?: Array<{
                sceneId: string;
                url: string | null;
                error?: string | null;
              }>;
            };
          };
          if (data.job.status === "completed" && data.job.outputs) {
            return data.job.outputs
              .map((o) => o.url)
              .filter((u): u is string => Boolean(u));
          }
          if (data.job.status === "failed") {
            const detail =
              data.job.errorMessage ??
              data.job.outputs?.find((output) => output.error)?.error;
            throw new Error(detail || "生成失败");
          }
        }
        throw new Error("生成超时，请稍后在“历史”查看");
      };

      const urls = await poll();
      setGeneratedUrls(urls);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setGenerating(false);
    }
  }, [
    productName,
    productDesc,
    customPrompt,
    generationMode,
    fidelity,
    selectedScenes,
    ratio,
    referenceImages,
    selectedModel,
    imagesPerScene,
    session?.access_token,
  ]);

  const previewPrompt = useCallback(async () => {
    const token = session?.access_token;
    if (!token || !productName || selectedScenes.size === 0) return;
    if (showPreview && promptPreview) {
      setShowPreview(false);
      return;
    }
    setPreviewingPrompt(true);
    setError(null);
    try {
      const response = await fetch("/api/ecom/prompts/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          productName,
          productDescription: productDesc || undefined,
          customPrompt: customPrompt.trim() || undefined,
          sceneIds: Array.from(selectedScenes),
          ratio,
          mode: generationMode,
          fidelity,
          referenceImageUrls: referenceImages
            .map((image) => image.uploadedUrl)
            .filter((url): url is string => Boolean(url)),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        prompts?: Array<{ sceneId: string; text: string; ratio: string }>;
        error?: { message?: string };
      };
      if (!response.ok || !body.prompts) {
        throw new Error(body.error?.message ?? "无法生成提示词预览");
      }
      setPromptPreview(body.prompts);
      setShowPreview(true);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "无法生成提示词预览");
    } finally {
      setPreviewingPrompt(false);
    }
  }, [customPrompt, fidelity, generationMode, productDesc, productName, promptPreview, ratio, referenceImages, selectedScenes, session?.access_token, showPreview]);

  return (
    <section className="mx-auto min-h-screen w-full max-w-screen-2xl bg-background px-4 pb-36 pt-6 md:px-6">
      {/* Header */}
      <header className="relative mb-7 flex flex-col gap-4 border-b border-border/40 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2">
          <Sparkles className="size-5 text-primary" strokeWidth={1.5} />
          <span className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
            AI 电商图像
          </span>
        </div>
        <h1 className="mb-1 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          电商详情图生成
        </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">填写商品信息、选择创作方向和参考素材，先看清费用再开始生成。</p>
        </div>

        <Link
          href="/ecom-images/history"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/50 bg-background px-3.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          aria-label="查看历史记录"
        >
          <History className="size-3.5" strokeWidth={1.5} />
          历史记录
        </Link>
      </header>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12 lg:gap-6 xl:gap-8">
        {/* Left: Config Panel */}
        <div className="space-y-4 lg:col-span-5">
          {/* Product Info */}
          <div className="glass rounded-2xl p-5 md:p-6">
            <h3 className="text-sm font-medium text-foreground mb-4">
              商品信息
            </h3>
            <label className="block mb-3">
              <span className="text-xs text-muted-foreground mb-1 block">
                商品名称
              </span>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="美的空气净化器"
                className="w-full h-10 rounded-xl glass-soft border border-border/40 px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground mb-1 block">
                商品描述（可选）
              </span>
              <textarea
                value={productDesc}
                onChange={(e) => setProductDesc(e.target.value)}
                placeholder="HEPA 滤网，PM2.5 过滤 99.97%..."
                rows={2}
                className="w-full rounded-xl glass-soft border border-border/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-muted-foreground">
                自定义提示词（可选）
              </span>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="例如：自然窗光下的真实使用场景，暖色但不过度修饰"
                rows={2}
                maxLength={4000}
                className="w-full resize-none rounded-xl glass-soft border border-border/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <span className="mt-1 block text-right text-[10px] text-muted-foreground">
                {customPrompt.length}/4000 · 会优先遵循你的要求
              </span>
            </label>
          </div>

          {/* Ratio */}
          <div className="glass rounded-2xl p-5 md:p-6">
            <h3 className="mb-1 text-sm font-medium text-foreground">创作模式</h3>
            <p className="mb-4 text-[11px] text-muted-foreground">不同模式使用独立构图规则，不再套用同一套留白模板</p>
            <div className="grid grid-cols-2 gap-2">
              {GENERATION_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={generationMode === mode.id}
                  onClick={() => {
                    setGenerationMode(mode.id);
                    setRatio(mode.ratio);
                    setSelectedScenes(new Set([mode.scene]));
                  }}
                  className={cn(
                    "min-h-16 rounded-xl border p-3 text-left transition-colors",
                    generationMode === mode.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border/50 bg-background/40 hover:border-foreground/30",
                  )}
                >
                  <span className="block text-xs font-medium">{mode.label}</span>
                  <span className={cn("mt-1 block text-[10px]", generationMode === mode.id ? "text-background/70" : "text-muted-foreground")}>{mode.note}</span>
                </button>
              ))}
            </div>
            <h3 className="mb-2 mt-5 text-xs font-medium text-foreground">商品保真度</h3>
            <div className="grid grid-cols-3 gap-2">
              {FIDELITY_LEVELS.map((level) => (
                <button
                  key={level.id}
                  type="button"
                  title={level.note}
                  aria-pressed={fidelity === level.id}
                  onClick={() => setFidelity(level.id)}
                  className={cn(
                    "h-9 rounded-lg border text-xs transition-colors",
                    fidelity === level.id
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border/50 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {level.label}
                </button>
              ))}
            </div>
            {generationMode === "detail-poster" && (
              <div className="mt-5 border-t border-border/40 pt-4">
                <p className="text-xs font-medium text-foreground">整张画面由图片模型创作</p>
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">商品、参考图、场景、装饰和文案方向会一起交给模型，自然融合成一张完整海报；系统不切片拼贴或叠加独立面板。</p>
              </div>
            )}
          </div>

          {/* Model */}
          <div className="glass rounded-2xl p-5 md:p-6">
            <label
              htmlFor="ecom-model"
              className="mb-3 block text-sm font-medium text-foreground"
            >
              生成模型
            </label>
            <StyledSelect
              value={selectedModel}
              onChange={setSelectedModel}
              aria-label="生成模型"
              options={compatibleModels.map((item) => ({
                value: item.id,
                label: item.displayName,
                note: getModelPricingLabel(item, "image"),
              }))}
            />
            {compatibleModels.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {referenceImages.length > 0
                  ? "暂无支持参考图的可用模型，请稍后重试。"
                  : "暂无可用图片模型，请联系管理员配置。"}
              </p>
            )}
            {referenceImages.length > 0 && compatibleModels.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                已仅显示支持参考图的高还原模型
              </p>
            )}
          </div>

          {/* Ratio */}
          <div className="glass rounded-2xl p-5 md:p-6">
            <h3 className="text-sm font-medium text-foreground mb-4">
              画面比例
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {RATIOS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRatio(r)}
                  className={cn(
                    "h-8 rounded-lg text-xs transition-all duration-200",
                    r === ratio
                      ? "bg-foreground text-background"
                      : "glass-soft hover:glass text-foreground",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Reference images */}
          <div className="glass rounded-2xl p-5 md:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium text-foreground">参考素材库（可选）</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">首张为主商品图，其余用于补充角度、细节和品牌风格</p>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">已上传 {referenceImages.length} / {MAX_REFERENCE_IMAGES}</span>
            </div>
            {referenceImages.length > 0 && (
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {referenceImages.map((image, index) => (
                  <div key={image.id} className="group relative overflow-hidden rounded-xl border border-border/50 bg-background/50">
                    <img src={image.previewUrl} alt={`参考图 ${index + 1}`} className="aspect-square w-full object-cover" />
                    <div className="absolute inset-x-0 top-0 flex items-center justify-between p-1.5">
                      <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", index === 0 ? "bg-primary text-primary-foreground" : "bg-black/60 text-white")}>
                        {index === 0 ? "主参考图" : `参考 ${index + 1}`}
                      </span>
                      <button type="button" aria-label={`删除参考图 ${index + 1}`} onClick={() => removeReference(image.id)} className="flex size-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                        <X className="size-3.5" />
                      </button>
                    </div>
                    {image.uploading && <div className="absolute inset-0 flex items-center justify-center bg-background/75 text-xs font-medium">上传中…</div>}
                    {!image.uploading && (
                      <div className="flex h-9 items-center justify-center gap-1 border-t border-border/50 px-1">
                        {index > 0 && <button type="button" title="设为主参考图" aria-label="设为主参考图" onClick={() => makePrimary(index)} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><Crown className="size-3.5" /></button>}
                        <button type="button" title="向前移动" aria-label="向前移动" disabled={index === 0} onClick={() => moveReference(index, -1)} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-25"><ChevronLeft className="size-3.5" /></button>
                        <button type="button" title="向后移动" aria-label="向后移动" disabled={index === referenceImages.length - 1} onClick={() => moveReference(index, 1)} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-25"><ChevronRight className="size-3.5" /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {referenceImages.length < MAX_REFERENCE_IMAGES && (
              <label
                className="flex h-28 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/40 transition-colors hover:border-primary/40"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void uploadReferences(Array.from(event.dataTransfer.files));
                }}
              >
                <ImageIcon
                  className="size-6 text-muted-foreground/40 mb-2"
                  strokeWidth={1.5}
                />
                <span className="text-xs text-muted-foreground">
                  拖拽或点击上传
                </span>
                <span className="mt-1 text-[10px] text-muted-foreground/70">可一次选择多张 · 单张 ≤25MB · 最多 10 张</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void uploadReferences(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
              </label>
            )}
          </div>

          <div className="glass rounded-2xl p-5 md:p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-foreground">每个场景生成数量</h3>
                <p className="mt-1 text-xs text-muted-foreground">场景数 × 每场张数</p>
              </div>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-primary">共 {imageCount} 张</span>
            </div>
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="每个场景生成数量">
              {[1, 2, 3, 4].map((quantity) => (
                <button
                  key={quantity}
                  type="button"
                  aria-pressed={imagesPerScene === quantity}
                  onClick={() => setImagesPerScene(quantity)}
                  className={cn(
                    "h-10 rounded-xl border text-sm font-medium tabular-nums transition-colors",
                    imagesPerScene === quantity
                      ? "border-foreground bg-foreground text-background"
                      : "border-border/50 bg-background/40 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                  )}
                >
                  {quantity}
                </button>
              ))}
            </div>
          </div>

          {routing && (
            <div className="rounded-xl border border-border/50 bg-background/60 px-4 py-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">实际执行模型</span>
                <span className="font-medium text-foreground">{routing.selectedModel}</span>
              </div>
              {routing.fallback && (
                <p className="mt-2 text-amber-600 dark:text-amber-400">原模型不可用或不支持参考图，已发生路由切换</p>
              )}
            </div>
          )}

          {/* Prompt preview toggle */}
          {selectedScenes.size > 0 && productName && (
            <button
              type="button"
              onClick={previewPrompt}
              disabled={previewingPrompt}
              className="inline-flex items-center justify-center gap-1.5 w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {previewingPrompt ? (
                <>正在组装真实提示词…</>
              ) : showPreview ? (
                <>
                  <EyeOff className="size-3" strokeWidth={1.5} />
                  隐藏提示词预览
                </>
              ) : (
                <>
                  <Eye className="size-3" strokeWidth={1.5} />
                  预览提示词
                </>
              )}
            </button>
          )}

          {showPreview && selectedScenes.size > 0 && productName && (
            <div className="glass-soft border border-border/30 rounded-2xl p-4 max-h-64 overflow-y-auto space-y-3">
              {(promptPreview ?? []).map((prompt) => {
                const scene = SCENES.find((s) => s.id === prompt.sceneId);
                return (
                  <div key={prompt.sceneId}>
                    <p className="text-[11px] font-medium text-foreground/80 mb-1">
                      {scene?.nameZh ?? prompt.sceneId} · {prompt.ratio} · {generationMode} · {fidelity}
                    </p>
                    <p className="whitespace-pre-wrap text-[10px] font-mono leading-relaxed text-muted-foreground/80">
                      {prompt.text}
                    </p>
                  </div>
                );
              })}
              <p className="pt-1 text-[10px] text-muted-foreground/50">以上为服务端实际组装内容，预览不扣积分。</p>
            </div>
          )}

          {error && (
            <p
              className="text-xs text-destructive mt-2 font-light"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        {/* Right: Scene Selector */}
        <div className="min-w-0 space-y-5 lg:col-span-7">
          <section className="glass overflow-hidden rounded-2xl p-5 md:p-6" aria-label="生成画布预览">
            <div className="grid items-center gap-5 sm:grid-cols-[minmax(128px,0.75fr)_minmax(0,1.25fr)] md:gap-7">
              <div className="flex min-h-52 items-center justify-center rounded-xl bg-muted/40 p-4">
                <div className={cn("flex w-full max-w-40 items-center justify-center rounded-lg border border-dashed border-border bg-background/80 p-3 text-center shadow-sm", previewRatioClasses[ratio])}>
                  <div className="space-y-2">
                    <ImageIcon className="mx-auto size-7 text-muted-foreground/45" strokeWidth={1.4} />
                    <span className="block text-[11px] font-medium text-muted-foreground">{ratio} 画布</span>
                  </div>
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">创作预览</span>
                  <span className="text-xs text-muted-foreground">{generationMode === "detail-poster" ? "完整海报由图片模型创作" : GENERATION_MODES.find((item) => item.id === generationMode)?.label}</span>
                </div>
                <h2 className="mt-3 truncate text-lg font-semibold text-foreground">{productName || "你的商品将在这里呈现"}</h2>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{customPrompt.trim() || productDesc || "添加商品名称、描述或创作要求，右侧会同步展示本次输出设置。"}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs text-muted-foreground">画幅 {ratio}</span>
                  <span className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs text-muted-foreground">{fidelity === "strict" ? "严格保真" : fidelity === "balanced" ? "平衡创作" : "自由创作"}</span>
                  <span className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs text-muted-foreground">参考图 {referenceImages.length} 张</span>
                </div>
              </div>
            </div>
          </section>

          <div className="glass rounded-2xl p-5 md:p-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="flex items-center text-sm font-semibold text-foreground">
                选择场景模板
                {selectedScenes.size > 0 && (
                  <span className="ml-2 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground shadow-sm">
                    已选 {selectedScenes.size}
                  </span>
                )}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">可多选场景；生成数量和费用会固定显示在页面底部。</p>
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索场景..."
                className="h-10 w-full rounded-xl border border-border/50 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 sm:w-56"
              />
            </div>

            {CATEGORIES.map((category) => {
              const scenes = filteredScenes.filter(
                (s) => s.category === category,
              );
              if (scenes.length === 0) return null;
              return (
                <div key={category} className="mb-6 last:mb-0">
                  <p className="text-xs text-muted-foreground font-medium tracking-wider uppercase mb-3">
                    {category}
                  </p>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                    {scenes.map((scene) => (
                      <button
                        key={scene.id}
                        data-testid="scene-card"
                        onClick={() => toggleScene(scene.id)}
                        aria-pressed={selectedScenes.has(scene.id)}
                        className={cn(
                          "relative min-h-[4.5rem] rounded-xl border px-3 py-3 text-left transition-all duration-200",
                          "glass-soft border-border/30 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm",
                          selectedScenes.has(scene.id) &&
                            "!border-primary !bg-primary !text-primary-foreground shadow-md ring-2 ring-primary/30",
                        )}
                      >
                        {selectedScenes.has(scene.id) && (
                          <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary-foreground text-primary">
                            <Check className="size-3" strokeWidth={2.5} />
                          </span>
                        )}
                        <p className={cn("truncate pr-6 text-sm font-medium", selectedScenes.has(scene.id) ? "text-primary-foreground" : "text-foreground")}>
                          {scene.name}
                        </p>
                        <p className={cn("truncate text-[10px]", selectedScenes.has(scene.id) ? "text-primary-foreground/80" : "text-muted-foreground")}>
                          {scene.nameZh}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-4 text-xs">
              {selectedScenes.size > 0 && <span className="font-medium text-foreground">已选 {selectedScenes.size} 个场景</span>}
              <span className="text-muted-foreground">{selectedScenes.size === 0 ? "请选择至少一个场景" : `${imageCount} 张输出 · 预计 ${creditsLabel} 积分`}</span>
            </div>
          </div>
        </div>
      </div>

      {portalReady && createPortal(
      <div data-testid="generation-action-bar" className="fixed inset-x-0 bottom-0 z-[100] border-t border-border/60 bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_36px_rgba(15,23,42,0.08)] backdrop-blur-xl max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] md:left-16 md:px-6">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center justify-between gap-5 sm:justify-start">
            <div>
              <p className="text-[11px] text-muted-foreground">本次预计消耗</p>
              <p className={cn("mt-0.5 text-sm font-semibold tabular-nums", canAfford ? "text-foreground" : "text-destructive")}>{creditsLabel} 积分</p>
            </div>
            <div className="hidden h-8 w-px bg-border sm:block" />
            <div className="text-right sm:text-left">
              <p className="text-[11px] text-muted-foreground">输出</p>
              <p className="mt-0.5 text-sm font-medium text-foreground">{selectedScenes.size} 场景 · {imageCount} 张</p>
            </div>
            <p className="hidden text-xs text-muted-foreground md:block">可用 {creditsAvailable.toLocaleString()} 积分</p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={!productName || selectedScenes.size === 0 || generating || referenceImages.some((image) => image.uploading || !image.uploadedUrl) || !canAfford}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-6 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:min-w-56"
          >
            {generating ? (
              <><div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />生成中…</>
            ) : (
              <><Zap className="size-4" strokeWidth={1.7} />生成 {imageCount} 张图片</>
            )}
          </button>
        </div>
        {!canAfford && (
          <div className="mx-auto mt-1 max-w-screen-2xl text-right">
            <Link href="/settings?tab=billing" className="text-[11px] font-medium text-destructive hover:underline">积分不足 · 前往充值</Link>
          </div>
        )}
      </div>, document.body)}

      {/* Generated Images Grid */}
      {generatedUrls.length > 0 && (
        <div className="mt-12">
          <h3 className="text-sm font-medium text-foreground mb-6">生成结果</h3>
          {generationMode === "detail-poster" && (
            <p className="mb-4 text-xs text-muted-foreground">由图片模型一次生成完整画面，点击图片查看原图。</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {generatedUrls.map((url, i) => (
              <div
                key={url}
                className="glass rounded-2xl overflow-hidden hover:-translate-y-1 transition-all duration-300 group"
              >
                <img
                  src={url}
                  alt={`Generated ${i + 1}`}
                  onClick={() => setPreviewImage(url)}
                  className="h-auto w-full cursor-zoom-in object-contain"
                />
                <div className="p-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    #{i + 1}
                  </span>
                  <a
                    href={url}
                    download
                    className="text-xs text-primary hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    下载
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {previewImage && (
        <EcomImagePreviewDialog src={previewImage} onClose={() => setPreviewImage(null)} />
      )}
    </section>
  );
}
