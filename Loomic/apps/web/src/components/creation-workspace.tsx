"use client";

import { Download, ImageIcon, LoaderCircle, Sparkles, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  fetchImageModels,
  fetchVideoModels,
  generateImageDirect,
  generateVideoDirect,
  type ImageModelInfo,
  type VideoModelInfo,
} from "@/lib/server-api";
import { StyledSelect } from "@/components/ui/styled-select";
import { getModelPricingLabel } from "@/lib/model-pricing";

type CreationMode = "image" | "video";
type GeneratedMedia = { url: string; prompt: string; mimeType: string };

type ModelAdvice = { badge: string; note: string };

function getModelAdvice(model: VideoModelInfo): ModelAdvice {
  const id = model.id.toLowerCase();
  if (id.includes("veo-3.1") && !id.includes("fast")) return { badge: "画质优先", note: "细节和镜头表现强，生成时间较长" };
  if (id.includes("fast") || id.includes("turbo")) return { badge: "速度优先", note: "适合快速预览和反复试稿" };
  if (id.includes("kling") || id.includes("hailuo") || id.includes("h3")) return { badge: "动作稳定", note: "人物动作和镜头运动表现均衡" };
  if (model.capabilities?.audio) return { badge: "支持音频", note: "可生成带声音的视频" };
  if (model.limits?.maxResolution === "1080p" || model.limits?.maxResolution === "2160p") return { badge: "高清", note: "支持较高分辨率输出" };
  return { badge: "基础", note: "适合日常草稿和简单动效" };
}

const IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
const VIDEO_RATIOS = ["16:9", "9:16"] as const;

export function CreationWorkspace({ mode }: { mode: CreationMode }) {
  const { session } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<Array<ImageModelInfo | VideoModelInfo>>([]);
  const [ratio, setRatio] = useState("1:1");
  const [quality, setQuality] = useState("hd");
  const [duration, setDuration] = useState(5);
  const [loadingModels, setLoadingModels] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [media, setMedia] = useState<GeneratedMedia | null>(null);

  const isVideo = mode === "video";
  const ratios = isVideo ? VIDEO_RATIOS : IMAGE_RATIOS;
  const title = isVideo ? "AI 视频创作" : "AI 图片创作";
  const Icon = isVideo ? Video : ImageIcon;

  useEffect(() => {
    let active = true;
    setLoadingModels(true);
    const request = isVideo ? fetchVideoModels() : fetchImageModels();
    void request
      .then((response) => {
        const nextModels = response.models;
        const defaultModel = "defaultModel" in response ? response.defaultModel : undefined;
        if (!active) return;
        const accessible = nextModels.filter((item) => item.accessible !== false);
        setModels(accessible);
        setModel(accessible[0]?.id ?? (isVideo ? "" : defaultModel ?? "black-forest-labs/flux-kontext-pro"));
      })
      .catch((cause) => {
        console.error(`[${mode}-workspace] Failed to load models`, cause);
        if (active) setError("模型列表加载失败，请刷新后重试。");
      })
      .finally(() => active && setLoadingModels(false));
    return () => { active = false; };
  }, [isVideo, mode]);

  useEffect(() => setRatio(isVideo ? "16:9" : "1:1"), [isVideo]);

  const selectedModel = useMemo(
    () => models.find((item) => item.id === model),
    [model, models],
  );
  const selectedAdvice = isVideo && selectedModel
    ? getModelAdvice(selectedModel as VideoModelInfo)
    : null;

  async function onGenerate() {
    const token = session?.access_token;
    const cleanPrompt = prompt.trim();
    if (!token || !cleanPrompt || !model || generating) return;
    setGenerating(true);
    setError("");
    try {
      const nextMedia = isVideo
        ? await generateVideoDirect(token, cleanPrompt, {
            model,
            duration,
            resolution: quality,
            aspectRatio: ratio,
          })
        : await generateImageDirect(token, cleanPrompt, {
            model,
            quality,
            aspectRatio: ratio,
          });
      setMedia(nextMedia);
    } catch (cause) {
      console.error(`[${mode}-workspace] Generation failed`, cause);
      setError(cause instanceof Error ? cause.message : "生成失败，请稍后重试。");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-full max-w-7xl gap-8 p-6 md:grid-cols-[minmax(320px,420px)_1fr] md:p-10">
      <section className="flex flex-col">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-foreground text-background"><Icon className="size-5" /></span>
          <div><p className="text-sm text-muted-foreground">独立创作空间</p><h1 className="text-2xl font-semibold">{title}</h1></div>
        </div>

        <label className="mt-8 text-sm font-medium" htmlFor={`${mode}-prompt`}>描述你的创作</label>
        <textarea
          id={`${mode}-prompt`}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={isVideo ? "描述主体、动作、镜头运动、光线与氛围..." : "描述主体、构图、风格、光线与细节..."}
          className="mt-2 min-h-40 resize-y rounded-lg border bg-background p-4 text-sm outline-none focus:ring-2 focus:ring-foreground/20"
        />

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="模型">
            <StyledSelect
              value={model}
              onChange={setModel}
              disabled={loadingModels}
              aria-label="模型"
              options={models.map((item) => {
                const advice = isVideo ? getModelAdvice(item as VideoModelInfo) : undefined;
                return { value: item.id, label: item.displayName, note: getModelPricingLabel(item, isVideo ? "video" : "image"), ...advice };
              })}
            />
          </Field>
          <Field label="画幅">
            <StyledSelect value={ratio} onChange={setRatio} aria-label="画幅" options={ratios.map((item) => ({ value: item, label: item }))} />
          </Field>
          <Field label={isVideo ? "清晰度" : "质量"}>
            <StyledSelect value={quality} onChange={setQuality} aria-label={isVideo ? "清晰度" : "质量"} options={(isVideo ? ["720p", "1080p"] : ["standard", "hd", "ultra"]).map((item) => ({ value: item, label: item }))} />
          </Field>
          {isVideo && <Field label="时长"><StyledSelect value={String(duration)} onChange={(item) => setDuration(Number(item))} aria-label="时长" options={[5, 8, 10].map((item) => ({ value: String(item), label: `${item} 秒` }))} /></Field>}
        </div>

        {selectedModel && <div className="mt-4 rounded-xl border border-border/60 bg-muted/30 p-3 text-xs leading-5">
          {selectedAdvice && <p className="font-medium text-foreground">{selectedAdvice.badge} · {selectedAdvice.note}</p>}
          <p className="mt-1 text-muted-foreground">{selectedModel.description}</p>
          <p className="mt-1 font-medium text-foreground">{getModelPricingLabel(selectedModel, isVideo ? "video" : "image")}</p>
        </div>}
        {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        <button type="button" onClick={() => void onGenerate()} disabled={!prompt.trim() || !model || generating} className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-foreground px-5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40">
          {generating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {generating ? "正在生成" : "开始生成"}
        </button>
      </section>

      <section className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
        {media ? <div className="relative flex h-full w-full items-center justify-center p-4">{isVideo ? <video src={media.url} controls className="max-h-[75vh] max-w-full rounded-md" /> : <img src={media.url} alt={media.prompt} className="max-h-[75vh] max-w-full rounded-md object-contain" />}<a href={media.url} download className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-lg border bg-background shadow-sm" aria-label="下载生成结果"><Download className="size-4" /></a></div> : <div className="max-w-sm p-8 text-center text-muted-foreground"><Icon className="mx-auto size-12 opacity-30" /><p className="mt-4 text-sm">生成结果将在这里显示，并自动保存到我的资产。</p></div>}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2 text-sm font-medium">{label}{children}</label>;
}
