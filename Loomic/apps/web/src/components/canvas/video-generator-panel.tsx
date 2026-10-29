"use client";

import { getConfiguredVideoPriceRates, getVideoCreditCost } from "@helstera/shared";
import { Plus, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useGenerationErrorHandler } from "../../hooks/use-generation-error-handler";
import {
  type VideoGeneratorData,
  resizeVideoGeneratorElement,
  updateVideoGeneratorElement,
} from "../../lib/canvas-video-generator";
import type { VideoModelInfo } from "../../lib/server-api";
import { fetchVideoModels, generateVideoDirect, uploadFile } from "../../lib/server-api";
import { t, useLocale } from "../../lib/i18n";
import { getModelPricingLabel } from "../../lib/model-pricing";
import { formatModelDisplayName } from "../chat/utils";

type VideoResolution = "480p" | "720p" | "768p" | "1080p" | "1088p" | "1440p" | "2160p" | "4k";
// No longer needs poster frame extraction -- videos use embeddable elements

type VideoGeneratorPanelProps = {
  elementId: string;
  elementBounds: { x: number; y: number; width: number; height: number };
  data: VideoGeneratorData;
  excalidrawApi: any;
  accessToken: string;
  canvasScrollZoom: { scrollX: number; scrollY: number; zoom: number };
  onClose: () => void;
};

const ASPECT_RATIOS = ["16:9", "9:16"] as const;
const DURATIONS = [4, 5, 6, 8, 10, 12, 15, 20, 25, 30] as const;
const VIDEO_RESOLUTIONS = ["720p", "1080p", "4k"] as const;

function supportedResolutions(
  model?: VideoModelInfo,
): readonly VideoResolution[] {
  const configured = model?.resolutionRates?.length
    ? model.resolutionRates.map((rate) => rate.resolution)
    : model
      ? getConfiguredVideoPriceRates(model.id).map((rate) => rate.resolution)
      : [];
  if (configured?.length) return configured;
  const max = model?.limits?.maxResolution;
  if (max === "2160p" || max === "1440p" || max === "4k") return VIDEO_RESOLUTIONS;
  if (max === "1080p" || max === "1088p") return VIDEO_RESOLUTIONS.slice(0, 2);
  if (max === "768p") return ["720p"];
  if (max === "480p") return ["480p"];
  return VIDEO_RESOLUTIONS.slice(0, 1);
}

function supportedResolution(model?: VideoModelInfo, current?: string): VideoResolution {
  const options = supportedResolutions(model);
  if (options.includes(current as VideoResolution)) return current as VideoResolution;
  return options.find((option) => option === "768p") ?? options[0] ?? "720p";
}

export function VideoGeneratorPanel({
  elementId,
  elementBounds,
  data,
  excalidrawApi,
  accessToken,
  canvasScrollZoom,
  onClose,
}: VideoGeneratorPanelProps) {
  const copy = t(useLocale()).generation;
  const [prompt, setPrompt] = useState(data.prompt);
  const [model, setModel] = useState(data.model);
  const [aspectRatio, setAspectRatio] = useState(data.aspectRatio);
  const [duration, setDuration] = useState(data.duration);
  const [resolution, setResolution] = useState(data.resolution);
  const [loading, setLoading] = useState(data.status === "generating");
  const [error, setError] = useState<string | null>(data.errorMessage ?? null);
  const [models, setModels] = useState<VideoModelInfo[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showParamsPopover, setShowParamsPopover] = useState(false);
  const [firstFrame, setFirstFrame] = useState<{
    dataUrl: string;
    file: File;
  } | null>(null);
  const [lastFrame, setLastFrame] = useState<{
    dataUrl: string;
    file: File;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFrameInputRef = useRef<HTMLInputElement>(null);
  const lastFrameInputRef = useRef<HTMLInputElement>(null);
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const { handleGenerationError } = useGenerationErrorHandler();
  // AbortController for in-flight generation requests so we can cancel on unmount
  const abortRef = useRef<AbortController | null>(null);

  // Fetch available models with error logging
  useEffect(() => {
    let cancelled = false;
    fetchVideoModels()
      .then((r) => {
        if (cancelled) return;
        setModels(r.models);
        setModel((current) => {
          if (r.models.length === 0 || r.models.some((m) => m.id === current)) {
            return current;
          }
          const fallback = r.models[0];
          if (!fallback) return current;
          const fallbackId = fallback.id;
          updateVideoGeneratorElement(excalidrawApi, elementId, {
            model: fallbackId,
          });
          return fallbackId;
        });
      })
      .catch((err) => {
        console.warn("[video-gen] Failed to fetch models:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [excalidrawApi, elementId]);

  // Close dropdowns when clicking outside the panel
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
        setShowParamsPopover(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cancel in-flight generation on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [prompt]);

  // Calculate panel screen position from canvas coordinates
  const { scrollX, scrollY, zoom } = canvasScrollZoom;
  const screenX = (elementBounds.x + scrollX) * zoom;
  const screenY = (elementBounds.y + elementBounds.height + scrollY) * zoom + 8;

  const currentModel = models.find((m) => m.id === model);
  const durationOptions = currentModel?.limits?.allowedDurations ?? DURATIONS;
  const resolutionOptions = supportedResolutions(currentModel);
  const configuredRates = currentModel?.resolutionRates?.length
    ? currentModel.resolutionRates
    : currentModel
      ? getConfiguredVideoPriceRates(currentModel.id)
      : [];
  const currentConfiguredRate = configuredRates.find(
    (rate) => rate.resolution === resolution,
  );
  const currentPriceRate = currentModel?.pricing?.rates.find(
    (rate) => rate.resolution === resolution,
  );
  const currentCreditCost = useMemo(() => {
    try {
      return getVideoCreditCost(model, duration, resolution as VideoResolution);
    } catch {
      return undefined;
    }
  }, [duration, model, resolution]);

  const handleAspectRatioChange = useCallback(
    (ratio: string) => {
      setAspectRatio(ratio);
      resizeVideoGeneratorElement(excalidrawApi, elementId, ratio);
      updateVideoGeneratorElement(excalidrawApi, elementId, {
        aspectRatio: ratio,
      });
    },
    [excalidrawApi, elementId],
  );

  const handleDurationChange = useCallback(
    (d: number) => {
      setDuration(d);
      updateVideoGeneratorElement(excalidrawApi, elementId, { duration: d });
    },
    [excalidrawApi, elementId],
  );

  const handleResolutionChange = useCallback(
    (value: VideoResolution) => {
      setResolution(value);
      updateVideoGeneratorElement(excalidrawApi, elementId, {
        resolution: value,
      });
    },
    [excalidrawApi, elementId],
  );

  useEffect(() => {
    const nextResolution = supportedResolution(currentModel, resolution);
    if (nextResolution === resolution) return;
    setResolution(nextResolution);
    updateVideoGeneratorElement(excalidrawApi, elementId, { resolution: nextResolution });
  }, [currentModel, elementId, excalidrawApi, resolution]);

  const handleModelChange = useCallback(
    (m: string) => {
      const selected = models.find((candidate) => candidate.id === m);
      const nextDurations: readonly number[] =
        selected?.limits?.allowedDurations ?? DURATIONS;
      const nextDuration = nextDurations.includes(duration)
        ? duration
        : (nextDurations[0] ?? duration);
      const nextResolution = supportedResolution(selected, resolution);
      setModel(m);
      setDuration(nextDuration);
      setResolution(nextResolution);
      setShowModelDropdown(false);
      updateVideoGeneratorElement(excalidrawApi, elementId, {
        model: m,
        duration: nextDuration,
        resolution: nextResolution,
      });
    },
    [duration, excalidrawApi, elementId, models, resolution],
  );

  const handleFrameUpload = useCallback(
    (
      _type: "first" | "last",
      setter: React.Dispatch<
        React.SetStateAction<{ dataUrl: string; file: File } | null>
      >,
    ) => {
      return (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const image = new Image();
          image.onload = () => {
            const maxSide = 2048;
            const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
            setter({ dataUrl: canvas.toDataURL("image/jpeg", 0.86), file });
          };
          image.onerror = () => setter({ dataUrl: reader.result as string, file });
          image.src = reader.result as string;
        };
        reader.readAsDataURL(file);
        e.target.value = "";
      };
    },
    [],
  );

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || loading) return;

    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    updateVideoGeneratorElement(excalidrawApi, elementId, {
      status: "generating",
      prompt: prompt.trim(),
      model,
      aspectRatio,
      duration,
      resolution,
    });

    try {
      const frames = [firstFrame, lastFrame].filter(
        (frame): frame is { dataUrl: string; file: File } => Boolean(frame),
      );
      const uploadedFrames = needsPublicReferenceUrl(model)
        ? await Promise.all(
            frames.map(async (frame) => {
              const uploaded = await uploadFile(accessTokenRef.current, frame.file);
              return { url: uploaded.url, assetId: uploaded.asset.id };
            }),
          )
        : frames.map((frame) => ({ url: frame.dataUrl, assetId: undefined }));
      const inputImages = uploadedFrames.map((frame) => frame.url);
      const inputAssetIds = uploadedFrames.flatMap((frame) => frame.assetId ? [frame.assetId] : []);

      const result = await generateVideoDirect(
        accessTokenRef.current,
        prompt.trim(),
        {
          model,
          duration,
          resolution,
          aspectRatio,
          enableAudio: false,
          ...(inputImages.length ? { inputImages } : {}),
          ...(inputAssetIds.length ? { inputAssetIds } : {}),
        },
      );

      // Check if this generation was cancelled while awaiting
      if (controller.signal.aborted) return;

      // Create embeddable element for inline video playback on canvas.
      // Dynamic import -- excalidraw is client-only.
      const { convertToExcalidrawElements } = await import(
        "@excalidraw/excalidraw"
      );
      if (controller.signal.aborted) return;

      const newElements = convertToExcalidrawElements([
        {
          type: "embeddable",
          link: result.url,
          x: elementBounds.x,
          y: elementBounds.y,
          width: elementBounds.width,
          height: elementBounds.height,
          customData: {
            isVideo: true,
            mimeType: result.mimeType,
            durationSeconds: result.durationSeconds,
            title: prompt.trim().slice(0, 60),
            prompt: prompt.trim(),
          },
        } as any,
      ]);

      // Replace generator placeholder with video embeddable element
      const elements = excalidrawApi
        .getSceneElements()
        .map((el: any) =>
          el.id === elementId ? { ...el, isDeleted: true } : el,
        );
      excalidrawApi.updateScene({
        elements: [...elements, ...newElements],
        captureUpdate: "IMMEDIATELY",
      });

      onClose();
    } catch (err) {
      // Ignore aborted requests (user cancelled or component unmounted)
      if (controller.signal.aborted) return;

      console.error("[video-gen] Generation error:", err);
      const handled = handleGenerationError(err);
      if (!handled) {
        setError(copy.videoFailed);
      }
      setLoading(false);
      updateVideoGeneratorElement(excalidrawApi, elementId, {
        status: "error",
        errorMessage: copy.failed,
      });
    }
  }, [
    prompt,
    loading,
    model,
    aspectRatio,
    duration,
    resolution,
    firstFrame,
    lastFrame,
    excalidrawApi,
    elementId,
    elementBounds,
    onClose,
    handleGenerationError,
  ]);

  const resolutionLabel = currentConfiguredRate?.resolution ?? currentPriceRate?.displayResolution ?? resolution;
  const paramsLabel = `${aspectRatio} \u00B7 ${duration}s \u00B7 ${resolutionLabel}`;

  return createPortal(
    <div
      ref={panelRef}
      style={{ left: screenX, top: screenY }}
      className="fixed z-[100] w-[520px] rounded-[24px] border border-border/60 glass-soft shadow-card-hover backdrop-blur-lg"
      onKeyDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Frame upload area */}
      <div className="flex gap-2 p-2 pb-0">
        {/* First frame */}
        <input
          ref={firstFrameInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFrameUpload("first", setFirstFrame)}
        />
        <button
          type="button"
          onClick={() => firstFrameInputRef.current?.click()}
          className="flex h-[68px] w-[56px] flex-col items-center justify-center gap-1 rounded-2xl glass-soft border border-border/40 transition-all duration-300 hover:glass focus-visible:ring-2 focus-visible:ring-foreground/20 ?"
        >
          {firstFrame ? (
            <img
              src={firstFrame.dataUrl}
              alt={copy.firstFrame}
              className="h-full w-full rounded-2xl object-cover"
            />
          ) : (
            <>
              <Plus className="h-4 w-4 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">
                {copy.firstFrame}
              </span>
            </>
          )}
        </button>

        {/* Last frame */}
        <input
          ref={lastFrameInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFrameUpload("last", setLastFrame)}
        />
        <button
          type="button"
          onClick={() => lastFrameInputRef.current?.click()}
          className="flex h-[68px] w-[56px] flex-col items-center justify-center gap-1 rounded-2xl glass-soft border border-border/40 transition-all duration-300 hover:glass focus-visible:ring-2 focus-visible:ring-foreground/20 ?"
        >
          {lastFrame ? (
            <img
              src={lastFrame.dataUrl}
              alt={copy.lastFrame}
              className="h-full w-full rounded-2xl object-cover"
            />
          ) : (
            <>
              <Plus className="h-4 w-4 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">
                {copy.lastFrame}
              </span>
            </>
          )}
        </button>
      </div>

      {/* Prompt textarea */}
      <div className="px-4 py-3">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleGenerate();
            }
          }}
          placeholder={copy.prompt}
          disabled={loading}
          style={{ scrollbarWidth: "none" }}
          className="min-h-[44px] max-h-[140px] w-full resize-none border-none bg-transparent text-[14px] leading-[22px] text-foreground placeholder:text-muted-foreground focus:outline-none [&::-webkit-scrollbar]:hidden"
        />
      </div>

      {error && (
        <div className="mx-4 mb-2 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {currentConfiguredRate ? (
        <div className="mx-4 mb-2 text-[10px] tabular-nums text-muted-foreground">
          {currentConfiguredRate.resolution} · ¥{currentConfiguredRate.priceCnyPerSecond.toFixed(2)}/秒
        </div>
      ) : currentPriceRate ? (
        <div className="mx-4 mb-2 text-[10px] tabular-nums text-muted-foreground">
          {currentPriceRate.displayResolution} ·{" "}
          {currentPriceRate.providerPointsPerSecond}
          {" H3积分/秒 · 约 ¥"}
          {currentPriceRate.cnyPerSecond.min.toFixed(4)}–¥
          {currentPriceRate.cnyPerSecond.max.toFixed(4)}/秒
        </div>
      ) : null}

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between px-2 pb-2">
        {/* Left: params button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowParamsPopover((v) => !v)}
            className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-all duration-300 hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-foreground/20 ?"
          >
            <span className="text-foreground">{paramsLabel}</span>
            <svg
              className="h-3 w-3 text-muted-foreground"
              viewBox="0 0 12 24"
              fill="currentColor"
            >
              <path d="M8.546 10.33a.4.4 0 0 1 .566 0l.424.424a.4.4 0 0 1 0 .566l-3.041 3.041a.7.7 0 0 1-.99 0l-3.04-3.04a.4.4 0 0 1 0-.567l.423-.424a.4.4 0 0 1 .567 0L6 12.876z" />
            </svg>
          </button>
          {showParamsPopover && (
            <div className="absolute bottom-full left-0 z-50 mb-1 w-[220px] rounded-2xl border border-border/60 glass p-3 shadow-soft">
              {/* Aspect ratio row */}
              <div className="mb-3">
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Aspect Ratio
                </div>
                <div className="flex gap-1.5">
                  {ASPECT_RATIOS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleAspectRatioChange(r)}
                      className={`rounded-lg px-3 py-1 text-xs transition-all duration-300 ${
                        r === aspectRatio
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-foreground/20 ?/60"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              {/* Duration row */}
              <div>
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Duration
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {durationOptions.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleDurationChange(d)}
                      className={`rounded-lg px-3 py-1 text-xs transition-all duration-300 ${
                        d === duration
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-foreground/20 ?/60"
                      }`}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
              {/* Resolution row */}
              <div className="mt-3">
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Resolution
                </div>
                <div className="flex gap-1.5">
                  {resolutionOptions.map((value) => {
                    const providerLabel = configuredRates.find(
                      (rate) => rate.resolution === value,
                    )?.resolution ?? currentModel?.pricing?.rates.find(
                      (rate) => rate.resolution === value,
                    )?.displayResolution;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleResolutionChange(value)}
                        className={`rounded-lg px-3 py-1 text-xs transition-all duration-300 ${
                          value === resolution
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-foreground/20 ?/60"
                        }`}
                      >
                        {providerLabel ?? value}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: model selector + generate */}
        <div className="flex items-center gap-1.5">
          {/* Model selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowModelDropdown((v) => !v)}
              className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-all duration-300 hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-foreground/20 ?"
            >
              {currentModel?.iconUrl && (
                <img
                  src={currentModel.iconUrl}
                  alt=""
                  className="h-3.5 w-3.5 rounded-full"
                />
              )}
              <span className="text-foreground">
                {currentModel?.displayName ?? formatModelDisplayName(model)}
              </span>
              <svg
                className="h-3 w-3 text-muted-foreground"
                viewBox="0 0 12 24"
                fill="currentColor"
              >
                <path d="M8.546 10.33a.4.4 0 0 1 .566 0l.424.424a.4.4 0 0 1 0 .566l-3.041 3.041a.7.7 0 0 1-.99 0l-3.04-3.04a.4.4 0 0 1 0-.567l.423-.424a.4.4 0 0 1 .567 0L6 12.876z" />
              </svg>
            </button>
            {showModelDropdown && (
              <div className="absolute bottom-full right-0 z-50 mb-1 max-h-[280px] w-[260px] overflow-y-auto rounded-2xl border border-border/60 glass py-1 shadow-soft">
                {models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleModelChange(m.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-all duration-300 hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-foreground/20 ?${m.id === model ? "bg-muted" : ""}`}
                  >
                    {m.iconUrl && (
                      <img
                        src={m.iconUrl}
                        alt=""
                        className="h-3.5 w-3.5 rounded-full"
                      />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col text-foreground">
                      <span className="truncate">{m.displayName}</span>
                      <span className="truncate text-[10px] text-muted-foreground">{getModelPricingLabel(m, "video")}</span>
                    </span>
                    {typeof m.creditCost === "number" && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground">
                        <Zap className="h-2.5 w-2.5" />
                        {m.creditCost}
                      </span>
                    )}
                    {m.id === model && (
                      <svg
                        className="h-3 w-3 text-foreground"
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
                ))}
              </div>
            )}
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={!prompt.trim() || loading}
            className="flex h-8 items-center justify-center gap-1 rounded-full bg-primary px-3 text-primary-foreground transition-all duration-300 hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          >
            {loading ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-primary-foreground/30 border-t-primary-foreground dark:border-primary-foreground/30 dark:border-t-primary-foreground" />
            ) : (
              <>
                <svg
                  className="h-3.5 w-[9.3px] shrink-0"
                  viewBox="0 0 8 10"
                  fill="currentColor"
                >
                  <path d="M6.9 4.36H5.385V.76c0-.84-.447-1.01-.991-.38L4 .835.677 4.685c-.457.525-.265.955.422.955h1.517v3.6c0 .84.446 1.01.991.38L4 9.165l3.323-3.85c.456-.525.265-.955-.422-.955" />
                </svg>
                {typeof currentCreditCost === "number" && (
                  <span className="text-xs tabular-nums">
                    {currentCreditCost}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function needsPublicReferenceUrl(model: string): boolean {
  return model.includes("/") || /minimax-h3/i.test(model);
}
