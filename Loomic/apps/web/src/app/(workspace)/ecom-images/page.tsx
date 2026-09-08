"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useCredits } from "@/hooks/use-credits";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Zap,
  Image as ImageIcon,
  History,
  Eye,
  EyeOff,
  Wallet,
} from "lucide-react";
import { SCENES, RATIOS, CATEGORIES } from "./constants";

export { SCENES, RATIOS, CATEGORIES };

export default function EcomImagesPage() {
  const { session } = useAuth();
  const { balance: creditsAvailable } = useCredits();
  const [query, setQuery] = useState("");
  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(new Set());
  const [productName, setProductName] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>("1:1");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedUrls, setGeneratedUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Derived state: credit cost + whether user can afford
  const creditsNeeded = selectedScenes.size * 10;
  const canAfford = creditsAvailable >= creditsNeeded;

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
          sceneIds: Array.from(selectedScenes),
          ratio,
          referenceImageUrl: referenceImage || undefined,
        }),
      });
      if (!createRes.ok) {
        const err = (await createRes.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(err.error?.message ?? "创建任务失败");
      }
      const { job } = (await createRes.json()) as {
        job: { id: string; status: string };
      };

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
              outputs?: Array<{ sceneId: string; url: string | null }>;
            };
          };
          if (data.job.status === "completed" && data.job.outputs) {
            return data.job.outputs
              .map((o) => o.url)
              .filter((u): u is string => Boolean(u));
          }
          if (data.job.status === "failed") {
            throw new Error("生成失败");
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
  }, [productName, productDesc, selectedScenes, ratio, referenceImage, session?.access_token]);

  return (
    <section className="min-h-screen bg-background py-8 px-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-12 text-center relative">
        <div className="inline-flex items-center gap-2 mb-4">
          <Sparkles className="size-5 text-primary" strokeWidth={1.5} />
          <span className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
            AI 电商图像
          </span>
        </div>
        <h1 className="text-3xl md:text-4xl font-medium tracking-tight text-foreground mb-3">
          电商详情图生成
        </h1>
        <p className="text-muted-foreground text-sm max-w-lg mx-auto">
          25 个专业场景模板，从白底主图到运动场景，一键生成高质量商品图像。
        </p>

        <Link
          href="/ecom-images/history"
          className="absolute right-0 top-0 inline-flex items-center gap-1.5 rounded-full glass-soft border border-border/40 px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:glass transition-all duration-300"
          aria-label="查看历史记录"
        >
          <History className="size-3.5" strokeWidth={1.5} />
          历史记录
        </Link>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Config Panel */}
        <div className="lg:col-span-1 space-y-6">
          {/* Product Info */}
          <div className="glass rounded-2xl p-6">
            <h3 className="text-sm font-medium text-foreground mb-4">商品信息</h3>
            <label className="block mb-3">
              <span className="text-xs text-muted-foreground mb-1 block">商品名称</span>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="美的空气净化器"
                className="w-full h-10 rounded-xl glass-soft border border-border/40 px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground mb-1 block">商品描述（可选）</span>
              <textarea
                value={productDesc}
                onChange={(e) => setProductDesc(e.target.value)}
                placeholder="HEPA 滤网，PM2.5 过滤 99.97%..."
                rows={3}
                className="w-full rounded-xl glass-soft border border-border/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
            </label>
          </div>

          {/* Ratio */}
          <div className="glass rounded-2xl p-6">
            <h3 className="text-sm font-medium text-foreground mb-4">画面比例</h3>
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

          {/* Reference Image */}
          <div className="glass rounded-2xl p-6">
            <h3 className="text-sm font-medium text-foreground mb-4">参考图（可选）</h3>
            {referenceImage ? (
              <div className="relative">
                <img
                  src={referenceImage}
                  alt="Reference"
                  className="w-full h-32 object-cover rounded-xl"
                />
                <button
                  onClick={() => setReferenceImage(null)}
                  className="absolute top-2 right-2 size-6 rounded-full bg-black/50 text-white text-xs flex items-center justify-center hover:bg-black/70 transition"
                >
                  ✕
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-border/40 rounded-xl cursor-pointer hover:border-primary/40 transition-colors">
                <ImageIcon className="size-6 text-muted-foreground/40 mb-2" strokeWidth={1.5} />
                <span className="text-xs text-muted-foreground">拖拽或点击上传</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = () => setReferenceImage(reader.result as string);
                      reader.readAsDataURL(file);
                    }
                  }}
                />
              </label>
            )}
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={
              !productName ||
              selectedScenes.size === 0 ||
              generating ||
              !canAfford
            }
            className={cn(
              "w-full h-12 rounded-full font-medium text-sm flex items-center justify-center gap-2 transition-all duration-300",
              "bg-foreground text-background hover:scale-[1.02] active:scale-[0.99]",
              "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100",
            )}
          >
            {generating ? (
              <>
                <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Zap className="size-4" strokeWidth={1.5} />
                生成 {selectedScenes.size} 张图片
              </>
            )}
          </button>

          {/* Credit balance + cost */}
          {selectedScenes.size > 0 && !generating && (
            <div
              className={cn(
                "glass-soft border rounded-2xl px-4 py-3 space-y-2",
                canAfford ? "border-border/40" : "border-destructive/40",
              )}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground font-light">
                  <Wallet className="size-3" strokeWidth={1.5} />
                  可用积分
                </span>
                <span className="font-medium tabular-nums text-foreground">
                  {creditsAvailable.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-light">本次预计消耗</span>
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    canAfford ? "text-foreground" : "text-destructive",
                  )}
                >
                  {creditsNeeded}
                </span>
              </div>
              {!canAfford && (
                <Link
                  href="/settings?tab=credits"
                  className="mt-2 flex items-center justify-center gap-1.5 w-full rounded-full bg-foreground text-background px-4 py-2 text-xs font-medium transition-all duration-300 hover:scale-[1.02] active:scale-[0.99]"
                >
                  <Sparkles className="size-3" strokeWidth={1.5} />
                  充值积分
                </Link>
              )}
            </div>
          )}

          {selectedScenes.size > 0 && !generating && canAfford && (
            <p className="text-[11px] text-muted-foreground/70 font-light text-center">
              预计消耗 {creditsNeeded} 积分
            </p>
          )}

          {/* Prompt preview toggle */}
          {selectedScenes.size > 0 && productName && (
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="inline-flex items-center justify-center gap-1.5 w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPreview ? (
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
              {Array.from(selectedScenes).map((id) => {
                const scene = SCENES.find((s) => s.id === id);
                return (
                  <div key={id}>
                    <p className="text-[11px] font-medium text-foreground/80 mb-1">
                      {scene?.nameZh ?? id}
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed">
                      {productName} {productDesc ? `· ${productDesc}` : ""} ·{" "}
                      {ratio} · 场景：{scene?.name ?? id}
                    </p>
                  </div>
                );
              })}
              <p className="text-[10px] text-muted-foreground/50 italic pt-1">
                提示词将在生成前由 Helstera 智能组装（铁律 + 风格锁）
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive mt-2 font-light" role="alert">
              {error}
            </p>
          )}
        </div>

        {/* Right: Scene Selector */}
        <div className="lg:col-span-2">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-medium text-foreground">
                选择场景模板
                {selectedScenes.size > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground font-light">
                    已选 {selectedScenes.size}
                  </span>
                )}
              </h3>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索场景..."
                className="h-8 w-40 rounded-lg glass-soft border border-border/40 px-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>

            {CATEGORIES.map((category) => {
              const scenes = filteredScenes.filter((s) => s.category === category);
              if (scenes.length === 0) return null;
              return (
                <div key={category} className="mb-6 last:mb-0">
                  <p className="text-xs text-muted-foreground font-medium tracking-wider uppercase mb-3">
                    {category}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {scenes.map((scene) => (
                      <button
                        key={scene.id}
                        onClick={() => toggleScene(scene.id)}
                        className={cn(
                          "rounded-xl px-3 py-2.5 text-left transition-all duration-200",
                          "glass-soft hover:glass border border-border/30",
                          selectedScenes.has(scene.id) && "ring-2 ring-primary/30 glass border-primary/20",
                        )}
                      >
                        <p className="text-xs font-medium text-foreground truncate">{scene.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{scene.nameZh}</p>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Generated Images Grid */}
      {generatedUrls.length > 0 && (
        <div className="mt-12">
          <h3 className="text-sm font-medium text-foreground mb-6">生成结果</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {generatedUrls.map((url, i) => (
              <div
                key={url}
                className="glass rounded-2xl overflow-hidden hover:-translate-y-1 transition-all duration-300 group"
              >
                <img
                  src={url}
                  alt={`Generated ${i + 1}`}
                  className="w-full aspect-square object-cover"
                />
                <div className="p-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">#{i + 1}</span>
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
    </section>
  );
}
