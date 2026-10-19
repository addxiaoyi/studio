"use client";

import type { ModelInfo } from "@helstera/shared";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { t, useLocale } from "@/lib/i18n";
import { StyledSelect } from "./ui/styled-select";
import { useImageModelPreference } from "@/hooks/use-image-model-preference";
import { useVideoModelPreference } from "@/hooks/use-video-model-preference";
import { fetchImageModels, fetchVideoModels, type ImageModelInfo, type VideoModelInfo } from "@/lib/server-api";
import { getModelPricingLabel } from "@/lib/model-pricing";

interface AgentSectionProps {
  defaultModel: string;
  onSave: (defaultModel: string) => Promise<void>;
  fetchModels: () => Promise<{ models: ModelInfo[] }>;
  autoApprovePaidGeneration: boolean;
  onAutoApproveChange: (value: boolean) => void;
  autoDeleteEmptyCanvas: boolean;
  onAutoDeleteEmptyCanvasChange: (value: boolean) => void;
}

export function AgentSection({
  defaultModel: initialModel,
  onSave,
  fetchModels,
  autoApprovePaidGeneration,
  onAutoApproveChange,
  autoDeleteEmptyCanvas,
  onAutoDeleteEmptyCanvasChange,
}: AgentSectionProps) {
  const copy = t(useLocale()).agent;
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const imagePreference = useImageModelPreference();
  const videoPreference = useVideoModelPreference();
  const [imageModels, setImageModels] = useState<ImageModelInfo[]>([]);
  const [videoModels, setVideoModels] = useState<VideoModelInfo[]>([]);
  const [mediaModelsLoading, setMediaModelsLoading] = useState(true);
  const [savingPreference, setSavingPreference] = useState(false);
  const [selectedModel, setSelectedModel] = useState(initialModel);

  useEffect(() => {
    setSelectedModel(initialModel);
  }, [initialModel]);

  const hasChanges = selectedModel !== initialModel;

  useEffect(() => {
    fetchModels()
      .then((data) => {
        setModelsError(false);
        setModels(data.models);
        const ids = data.models.map((m: ModelInfo) => m.id);
        if (ids.length > 0 && !ids.includes(selectedModel) && ids[0]) {
          setSelectedModel(ids[0]);
        }
      })
      .catch(() => {
        setModels([]);
        setModelsError(true);
      })
      .finally(() => setModelsLoading(false));
  }, [fetchModels]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchImageModels(), fetchVideoModels()])
      .then(([images, videos]) => {
        if (cancelled) return;
        setImageModels(images.models);
        setVideoModels(videos.models);
      })
      .finally(() => {
        if (!cancelled) setMediaModelsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedModel) return;

    setSaving(true);
    setFeedback(null);

    try {
      await onSave(selectedModel);
      setFeedback({ type: "success", message: copy.updated });
    } catch {
      setFeedback({
        type: "error",
        message: copy.updateFailed,
      });
    } finally {
      setSaving(false);
    }
  }

  async function changePaidGeneration(value: boolean) {
    setSavingPreference(true);
    setFeedback(null);
    try {
      await onAutoApproveChange(value);
      setFeedback({ type: "success", message: "扣费确认偏好已更新。" });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "保存扣费偏好失败，请重试。" });
    } finally {
      setSavingPreference(false);
    }
  }

  async function changeEmptyCanvasCleanup(value: boolean) {
    setSavingPreference(true);
    setFeedback(null);
    try {
      await onAutoDeleteEmptyCanvasChange(value);
      setFeedback({ type: "success", message: "空白画布整理偏好已更新。" });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "保存画布偏好失败，请重试。" });
    } finally {
      setSavingPreference(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-medium text-foreground">{copy.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground font-light">
          {copy.description}
        </p>
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="autoApprovePaidGeneration">自动确认付费生成</Label>
            <p id="autoApprovePaidGeneration-description" className="mt-1 text-xs leading-5 text-muted-foreground">
              {autoApprovePaidGeneration
                ? "开启后，图片和视频任务会直接提交并扣除 credits，不再逐次确认。"
                : "关闭后，每次生成前会先展示预计消耗，确认后才扣费。"}
            </p>
          </div>
          <input id="autoApprovePaidGeneration" type="checkbox" checked={autoApprovePaidGeneration} onChange={(event) => void changePaidGeneration(event.target.checked)} disabled={savingPreference} aria-busy={savingPreference} aria-describedby="autoApprovePaidGeneration-description" className="mt-1 size-4 accent-foreground disabled:opacity-50" />
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="autoDeleteEmptyCanvas">自动清理空白画布</Label>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">离开没有元素、文件、聊天记录或任务的空白画布时，自动归档对应项目。</p>
          </div>
          <input id="autoDeleteEmptyCanvas" type="checkbox" checked={autoDeleteEmptyCanvas} onChange={(event) => void changeEmptyCanvasCleanup(event.target.checked)} disabled={savingPreference} aria-busy={savingPreference} className="mt-1 size-4 accent-foreground disabled:opacity-50" />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-8">
        <div className="space-y-2.5">
          <Label htmlFor="defaultModel">{copy.defaultModel}</Label>
          {modelsLoading ? (
            <div
              className="h-9 w-full animate-pulse rounded-md border border-border/40 bg-foreground/[0.03]"
              aria-label={copy.loading}
            />
          ) : modelsError ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/[0.04] px-3 py-2 text-sm text-destructive">
              {copy.loadFailed}
            </p>
          ) : models.length === 0 ? (
            <div className="rounded-xl border border-border/40 bg-foreground/[0.03] px-3 py-3 text-sm text-muted-foreground">
              <p>{copy.empty}</p>
              <p className="mt-1 text-xs leading-5">{copy.mediaHint}</p>
              <Link
                href="/admin/providers"
                className="mt-3 inline-flex text-xs font-medium text-foreground underline underline-offset-4"
              >
                {copy.configure}
              </Link>
            </div>
          ) : (
            <StyledSelect
              value={selectedModel}
              onChange={setSelectedModel}
              aria-label={copy.defaultModel}
              options={models.map((model) => ({
                value: model.id,
                label: model.name,
                note: model.provider,
              }))}
            />
          )}
          <p className="text-xs text-muted-foreground">{copy.allSessions}</p>
        </div>

        <div className="grid gap-4 border-t border-border/60 pt-7 sm:grid-cols-2">
          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="mb-3">
              <Label htmlFor="defaultImageModel">默认图片模型</Label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">用于画布、电商图和聊天图片生成。智能路由会结合可用性自动回退。</p>
            </div>
            <StyledSelect
              value={imagePreference.preference.mode === "auto" ? "auto" : (imagePreference.preference.models[0] ?? "auto")}
              onChange={(value) => imagePreference.setPreference(value === "auto" ? { mode: "auto", models: imagePreference.preference.models } : { mode: "manual", models: [value] })}
              aria-label="默认图片模型"
              disabled={mediaModelsLoading}
              options={[
                { value: "auto", label: "智能路由", note: "自动选择可用且兼容的模型" },
                ...imageModels.map((model) => ({ value: model.id, label: model.displayName, note: `${model.id} · ${getModelPricingLabel(model, "image")}` })),
              ]}
            />
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="mb-3">
              <Label htmlFor="defaultVideoModel">默认视频模型</Label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">只展示探测可用的模型，并统一按元/秒显示售价。</p>
            </div>
            <StyledSelect
              value={videoPreference.preference.mode === "auto" ? "auto" : (videoPreference.preference.models[0] ?? "auto")}
              onChange={(value) => videoPreference.setPreference(value === "auto" ? { ...videoPreference.preference, mode: "auto" } : { ...videoPreference.preference, mode: "manual", models: [value] })}
              aria-label="默认视频模型"
              disabled={mediaModelsLoading}
              options={[
                { value: "auto", label: "智能路由", note: "根据首帧、时长、分辨率和健康状态选择" },
                ...videoModels.map((model) => ({ value: model.id, label: model.displayName, note: `${model.id} · ${model.limits?.maxResolution ?? "分辨率待配置"} · ${getModelPricingLabel(model, "video")}` })),
              ]}
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[5, 8, 10, 15].map((duration) => (
                <button key={duration} type="button" onClick={() => videoPreference.setDuration(duration)} className={
                  `rounded-full px-3 py-1 text-xs transition-colors ${videoPreference.preference.duration === duration ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`
                }>{duration} 秒</button>
              ))}
            </div>
          </div>
        </div>

        {feedback && (
          <p
            role={feedback.type === "error" ? "alert" : "status"}
            aria-live={feedback.type === "error" ? "assertive" : "polite"}
            className={`text-sm ${feedback.type === "success" ? "text-success" : "text-destructive"}`}
          >
            {feedback.message}
          </p>
        )}

        <Button
          type="submit"
          disabled={saving || !hasChanges}
          className="rounded-full bg-foreground text-background hover:bg-foreground/90"
        >
          {saving ? copy.saving : copy.save}
        </Button>
      </form>
    </div>
  );
}
