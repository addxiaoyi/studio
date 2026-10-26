"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getConfiguredVideoPriceRates } from "@helstera/shared";
import { useImageModelPreference } from "../hooks/use-image-model-preference";
import { useVideoModelPreference } from "../hooks/use-video-model-preference";
import { getModelPricingLabel } from "../lib/model-pricing";
import type { ImageModelInfo } from "../lib/server-api";
import type { VideoModelInfo } from "../lib/server-api";
import { fetchImageModels, fetchVideoModels } from "../lib/server-api";

const POPOVER_WIDTH = 380;
const POPOVER_GAP = 8;
const VIEWPORT_MARGIN = 8;

export function calculateModelPopoverLayout(anchor: DOMRect, viewport: { width: number; height: number }) {
  const width = Math.min(POPOVER_WIDTH, viewport.width - VIEWPORT_MARGIN * 2);
  const availableBelow = viewport.height - anchor.bottom - VIEWPORT_MARGIN;
  const availableAbove = anchor.top - VIEWPORT_MARGIN;
  const above = availableBelow < 420 && availableAbove > availableBelow;
  const maxHeight = Math.max(280, Math.min(620, (above ? availableAbove : availableBelow) - POPOVER_GAP));
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, anchor.right - width),
    viewport.width - width - VIEWPORT_MARGIN,
  );
  return {
    width,
    maxHeight,
    left,
    above,
    top: above ? undefined : anchor.bottom + POPOVER_GAP,
    bottom: above ? viewport.height - anchor.top + POPOVER_GAP : undefined,
  };
}

function modelVariantLabel(id: string) {
  const normalized = id.toLowerCase();
  if (normalized.endsWith("-4k-超分")) return "4K 超分辨率";
  if (normalized.endsWith("-4k")) return "4K";
  if (normalized.endsWith("-2k")) return "2K";
  if (normalized.endsWith("-1k")) return "1K";
  return "标准版";
}

function modelIdentity(id: string) {
  return id.startsWith("gpt-image-")
    ? `${id} · ${modelVariantLabel(id)}`
    : id;
}

function normalizeModelId(id: string) {
  return id.trim().toLowerCase();
}

function flagshipRates(model: VideoModelInfo) {
  return model.resolutionRates?.length
    ? model.resolutionRates
    : getConfiguredVideoPriceRates(model.id);
}

function rankVideoModels(models: VideoModelInfo[]) {
  const unique = new Map<string, VideoModelInfo>();
  for (const model of models) {
    const key = normalizeModelId(model.id);
    const current = unique.get(key);
    if (!current || compareVideoModelHealth(model, current) < 0) unique.set(key, model);
  }

  return [...unique.values()].sort((left, right) => {
    const leftFeatured = Number(normalizeModelId(left.id) !== "minimax-h3");
    const rightFeatured = Number(normalizeModelId(right.id) !== "minimax-h3");
    if (leftFeatured !== rightFeatured) return leftFeatured - rightFeatured;
    return compareVideoModelHealth(left, right);
  });
}

function compareVideoModelHealth(left: VideoModelInfo, right: VideoModelInfo) {
  const availabilityRank = (model: VideoModelInfo) => model.availability === "unavailable" ? 2 : model.availability === "available" ? 0 : 1;
  const healthRank = (model: VideoModelInfo) => model.healthStatus === "healthy" ? 0 : model.healthStatus === "degraded" ? 1 : 2;
  return availabilityRank(left) - availabilityRank(right)
    || healthRank(left) - healthRank(right)
    || (left.failureCount ?? 0) - (right.failureCount ?? 0)
    || (Number(left.id !== "minimax-h3") - Number(right.id !== "minimax-h3"))
    || left.id.localeCompare(right.id);
}

export function ImageModelPreferencePopover({
  open,
  onClose,
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const { preference, setMode, toggleModel } = useImageModelPreference();
  const [models, setModels] = useState<ImageModelInfo[]>([]);
  const [unavailableImageModels, setUnavailableImageModels] = useState<Array<ImageModelInfo & { availabilityReason?: string | null }>>([]);
  const [activeTab, setActiveTab] = useState<"image" | "video">("image");
  const videoPreference = useVideoModelPreference();
  const [videoModels, setVideoModels] = useState<VideoModelInfo[]>([]);
  const [unavailableVideoModels, setUnavailableVideoModels] = useState<VideoModelInfo[]>([]);
  const [videoModelNotice, setVideoModelNotice] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<Record<"image" | "video", "loading" | "ready" | "error">>({ image: "loading", video: "loading" });
  const [retry, setRetry] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<ReturnType<typeof calculateModelPopoverLayout> | null>(null);
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const featuredResolution = videoPreference.preference.resolution ?? "768p";
  const videoPreferenceRef = useRef(videoPreference);
  videoPreferenceRef.current = videoPreference;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadState({ image: "loading", video: "loading" });
    fetchImageModels()
      .then((data) => {
        if (cancelled) return;
        setModels(data.models);
        setUnavailableImageModels(data.unavailableModels);
        setLoadState((state) => ({ ...state, image: "ready" }));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[model-preference] image models:", error);
        setLoadState((state) => ({ ...state, image: "error" }));
      });
    fetchVideoModels()
      .then((data) => {
        if (cancelled) return;
        const currentPreference = videoPreferenceRef.current.preference;
        const selectableModels = rankVideoModels(data.models.filter((model) => model.availability !== "unavailable"));
        setVideoModels(rankVideoModels(data.models));
        setUnavailableVideoModels(rankVideoModels(data.unavailableModels.filter((model) => model.availability === "unavailable")));
        const selectedModels = [...new Set(currentPreference.models.flatMap((modelId) => {
          const selected = selectableModels.find((model) => model.id === modelId)
            ?? selectableModels.find((model) => normalizeModelId(model.id) === normalizeModelId(modelId));
          return selected ? [selected.id] : [];
        }))];
        const preferenceChanged = selectedModels.length !== currentPreference.models.length
          || selectedModels.some((modelId, index) => modelId !== currentPreference.models[index]);
        if (currentPreference.mode === "manual" && preferenceChanged) {
          const fallbackModel = selectableModels[0]?.id;
          const models = selectedModels.length > 0
            ? selectedModels
            : fallbackModel
              ? [fallbackModel]
              : [];
          if (models.length > 0) {
            videoPreferenceRef.current.setPreference({
              ...currentPreference,
              mode: currentPreference.mode,
              duration: currentPreference.duration,
              models,
            });
            if (selectedModels.length < currentPreference.models.length) setVideoModelNotice(
              selectedModels.length > 0
                ? "已移除当前不可用的模型"
                : "原选择已不可用，已切换到可用模型",
            );
          }
        }
        setLoadState((state) => ({ ...state, video: "ready" }));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[model-preference] video models:", error);
        setLoadState((state) => ({ ...state, video: "error" }));
      });
    return () => { cancelled = true; };
  }, [open, retry]);

  useEffect(() => {
    if (!open || (loadState.image !== "error" && loadState.video !== "error")) return;
    const timer = setTimeout(() => setRetry((value) => value + 1), 8_000);
    return () => clearTimeout(timer);
  }, [open, loadState, retry]);

  // Keep the picker inside the viewport on small laptops and mobile screens.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos(calculateModelPopoverLayout(rect, { width: window.innerWidth, height: window.innerHeight }));
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, anchorRef]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const currentPreference = activeTab === "image" ? preference : videoPreference.preference;
  const currentModels = activeTab === "image" ? models : videoModels;
  const currentSetMode = activeTab === "image" ? setMode : videoPreference.setMode;
  const currentToggleModel = activeTab === "image" ? toggleModel : videoPreference.toggleModel;
  const verifiedVideoModels = videoModels.filter((model) => model.healthStatus === "healthy");
  const unverifiedVideoModels = videoModels.filter((model) => model.healthStatus === "unknown");
  const videoDurations = [...new Set(videoModels.flatMap((model) => model.limits?.allowedDurations ?? [4, 5, 6, 8, 10, 12, 15, 20, 25, 30]))].sort((a, b) => a - b);
  const cooldownText = (until?: string | null) => {
    if (!until) return null;
    const seconds = Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));
    if (!seconds) return null;
    return seconds >= 60 ? `冷却 ${Math.ceil(seconds / 60)} 分钟` : `冷却 ${seconds} 秒`;
  };
  const rankedModels = activeTab === "video" ? rankVideoModels(videoModels) : currentModels;

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={popoverRef}
      style={{
        top: pos.top,
        bottom: pos.bottom,
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
      }}
      className="fixed z-[9999] overflow-hidden rounded-2xl border border-border/60 bg-background/95 p-1 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex max-h-[inherit] min-h-0 flex-col gap-3 py-2">
        {/* Tab switcher */}
        <div className="px-3">
          <div className="flex rounded-full glass-soft p-0.5">
            {(["image", "video"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-300 ${
                  activeTab === tab
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "image" ? "图片" : "视频"}
              </button>
            ))}
          </div>
        </div>

        {/* Header */}
        <div className="flex flex-col gap-2 px-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              {activeTab === "image" ? "图片模型" : "视频模型"}
            </span>
            <div className="flex rounded-full bg-muted p-0.5" role="group" aria-label="模型选择模式">
              {(["auto", "manual"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => currentSetMode(mode)}
                  aria-pressed={currentPreference.mode === mode}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ${
                    currentPreference.mode === mode
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode === "auto" ? "智能路由" : "手动选择"}
                </button>
              ))}
            </div>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {currentPreference.mode === "auto"
              ? `系统会根据输入、时长和可用性自动选择最佳${activeTab === "image" ? "图片" : "视频"}模型`
              : `仅在你选中的${activeTab === "image" ? "图片" : "视频"}模型中进行路由`}
          </span>
        </div>

        {/* Manual model list */}
        {(currentPreference.mode === "manual" || activeTab === "video") && (
          <div className="scrollbar-hidden min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-1">
            {loadState[activeTab] === "loading" && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">正在加载模型...</div>
            )}
            {loadState[activeTab] === "error" && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                模型加载失败
                <button type="button" className="ml-2 text-foreground underline" onClick={() => setRetry((value) => value + 1)}>重试</button>
              </div>
            )}
            {loadState[activeTab] === "ready" && currentModels.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                暂无可用的{activeTab === "image" ? "图片" : "视频"}模型
              </div>
            )}
            {activeTab === "image" && unavailableImageModels.length > 0 && (
              <details className="mx-1 mb-2 border-t border-border/40 pt-2">
                <summary className="cursor-pointer select-none px-2 text-[11px] text-muted-foreground">
                  查看 {unavailableImageModels.length} 个暂不可用图片模型
                </summary>
                <div className="mt-1 space-y-1 px-1">
                  {unavailableImageModels.map((model) => (
                    <div key={model.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                      <span className="truncate text-[11px] text-foreground/70">{model.displayName}</span>
                      <span className="shrink-0 text-[10px] text-amber-700 dark:text-amber-300">{model.availabilityReason ?? "等待重新探测"}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {loadState[activeTab] === "ready" && rankedModels.filter((model) => currentPreference.mode === "manual" || normalizeModelId(model.id) === "minimax-h3").map((m) => {
            const selected = currentPreference.models.some((modelId) => normalizeModelId(modelId) === normalizeModelId(m.id));
            const canSelect = activeTab !== "video" || ("availability" in m && m.availability !== "unavailable");
            const isFlagship = activeTab === "video" && m.id.trim().toLowerCase() === "minimax-h3";
            const isExpanded = expandedModelId === m.id;
            const rates = isFlagship ? flagshipRates(m as VideoModelInfo) : [];
            const selectedRate = rates.find((rate) => rate.resolution === featuredResolution) ?? rates[0];
            return (
              <div key={m.id} className={`rounded-lg ${selected ? "bg-accent/10" : ""}`}>
              <div className={`group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-all duration-300 ${selected ? "hover:bg-accent/15" : "hover:bg-foreground/[0.04]"} ${!canSelect ? "cursor-not-allowed opacity-50" : ""}`}>
                <button type="button" onClick={() => {
                  if (isFlagship) {
                    videoPreference.selectResolution(m.id, selectedRate?.resolution ?? "768p");
                    setExpandedModelId(isExpanded ? null : m.id);
                  } else currentToggleModel(m.id);
                }} disabled={!canSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed">
                {m.iconUrl && (
                  <img
                    src={m.iconUrl}
                    alt={m.displayName}
                    className="h-5 w-5 shrink-0 rounded-full object-cover"
                  />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-foreground">
                    {m.displayName}
                    {isFlagship && (
                      <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                        {"旗舰首推"}
                      </span>
                    )}
                    <span className="font-mono text-[10px] font-normal text-muted-foreground">
                      {modelIdentity(m.id)}
                    </span>
                    {activeTab === "video" && (
                      <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                        {("healthStatus" in m && m.healthStatus === "healthy") ? "已验证" : ("availability" in m && m.availability === "unavailable") ? "暂不可用" : "待生成验证"}
                      </span>
                    )}
                  </span>
                  {activeTab === "video" && (m.failureCount || m.cooldownUntil) && (
                    <span className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                      {cooldownText(m.cooldownUntil) ?? (m.failureCount ? `近期失败 ${m.failureCount} 次` : "")}
                    </span>
                  )}
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                    <span className="font-medium text-foreground">{isFlagship && selectedRate ? `${selectedRate.resolution} · ¥${selectedRate.priceCnyPerSecond.toFixed(2)}/秒` : getModelPricingLabel(m, activeTab)}</span>
                    <span>{m.description}</span>
                  </span>
                  {activeTab === "video" && (
                    <span className="mt-1 text-[10px] leading-tight text-muted-foreground">
                      {m.capabilities?.textToVideo ? "文生" : ""}{m.capabilities?.imageToVideo ? " · 图生" : ""}
                      {m.limits?.allowedDurations?.length ? ` · ${m.limits.allowedDurations.join("/")} 秒` : ""}
                      {m.limits?.maxResolution ? ` · 最高 ${m.limits.maxResolution}` : ""}
                    </span>
                  )}
                </div>
                {selected && (
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-accent-foreground"
                    viewBox="0 0 14 14"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M12.08 3.087a.583.583 0 0 1 0 .825L5.661 10.33a.583.583 0 0 1-.824 0L1.92 7.412a.583.583 0 0 1 .825-.825L5.25 9.092l6.004-6.005a.583.583 0 0 1 .825 0"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                </button>
                {isFlagship && (
                  <button type="button" aria-expanded={isExpanded} aria-label="展开 MiniMax H3 分辨率价格" onClick={() => setExpandedModelId(isExpanded ? null : m.id)} className="shrink-0 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
                    {isExpanded ? "收起" : "价格"}
                  </button>
                )}
              </div>
              {isFlagship && isExpanded && rates.length > 0 ? (
                <div role="radiogroup" aria-label="MiniMax H3 分辨率价格" className="grid grid-cols-2 gap-1.5 border-t border-border/40 px-2 pb-2 pt-1.5">
                  {rates.map((rate) => (
                    <button key={rate.resolution} type="button" role="radio" aria-checked={featuredResolution === rate.resolution} disabled={!canSelect} onClick={() => videoPreference.selectResolution(m.id, rate.resolution)} className={`flex items-center justify-between rounded-md px-2 py-1.5 text-[11px] disabled:opacity-50 ${featuredResolution === rate.resolution ? "bg-foreground text-background" : "bg-background/70 hover:bg-muted"}`}>
                      <span className="font-medium">{rate.resolution}</span>
                      <span className="tabular-nums opacity-80">¥{rate.priceCnyPerSecond.toFixed(2)}/秒</span>
                    </button>
                  ))}
                </div>
              ) : null}
              </div>
            );
            })}
          </div>
        )}
        {activeTab === "video" && (
          <div className="shrink-0 border-t border-border/40 bg-background/90 px-3 pt-2">
            {loadState.video === "ready" && (
              <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span><strong className="font-semibold text-emerald-600">{videoPreference.preference.mode === "auto" ? verifiedVideoModels.length : videoModels.length}</strong> {videoPreference.preference.mode === "auto" ? "verified models" : "models available to try"}</span>
                <span>{videoPreference.preference.mode === "manual" ? `路由池 ${videoPreference.preference.models.filter((id) => videoModels.some((model) => model.id === id)).length} 个` : "智能自动路由"}</span>
              </div>
            )}
            {videoModelNotice && (
              <div className="mb-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                {videoModelNotice}
              </div>
            )}
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">视频时长</div>
            <div className="flex flex-wrap gap-1.5">
              {videoDurations.map((duration) => (
                <button key={duration} type="button" onClick={() => videoPreference.setDuration(duration)} className={`rounded-lg px-3 py-1 text-xs transition-colors ${videoPreference.preference.duration === duration ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                  {duration}秒
                </button>
              ))}
            </div>
            {unavailableVideoModels.length > 0 && (
              <details className="mt-2 border-t border-border/40 pt-2">
                <summary className="cursor-pointer select-none text-[11px] text-muted-foreground">
                  查看 {unavailableVideoModels.length} 个暂不可用模型
                </summary>
                <div className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                  {unavailableVideoModels.map((model) => (
                    <div key={model.id} className="flex items-start justify-between gap-3 rounded-md bg-muted/50 px-2 py-1.5">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-medium text-foreground/70">{model.displayName}</div>
                        <div className="text-[10px] text-muted-foreground">{model.capabilities?.imageToVideo ? "支持首帧" : "仅文生视频"}{model.cooldownUntil ? ` · ${cooldownText(model.cooldownUntil) ?? "冷却中"}` : ""}</div>
                      </div>
                      <span className="max-w-36 text-right text-[10px] leading-tight text-amber-700 dark:text-amber-300">
                        {model.availabilityReason ?? "等待重新探测"}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
