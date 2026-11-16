"use client";

import { AppSelect } from "@/components/ui/app-select";
import { useStudioVideoGeneration } from "@/hooks/use-studio-video-generation";
import { useLocale } from "@/lib/i18n";
import { type VideoModelInfo, fetchVideoModels } from "@/lib/server-api";
import { readStudioAsset } from "@/lib/studio-media";
import type { StudioRuntime } from "@/lib/visualforge-runtime";
import type { VideoMaterialRequest } from "@helstera/shared";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { JobSettlementReview } from "./job-settlement-review";
import { Button } from "./ui/button";

type StudioMaterialGenerationProps = {
  request: Extract<VideoMaterialRequest, { type: "generate" }>;
  userId: string;
  token: string;
  runtime: StudioRuntime | null;
  compositionId: string;
  onImported(name: string): Promise<void>;
};

export function StudioMaterialGeneration(props: StudioMaterialGenerationProps) {
  const scope = JSON.stringify([
    props.userId,
    props.token,
    props.compositionId,
  ]);
  return <AccountMaterialGeneration key={scope} {...props} />;
}

function AccountMaterialGeneration({
  request,
  userId,
  token,
  runtime,
  compositionId,
  onImported,
}: StudioMaterialGenerationProps) {
  const english = useLocale() === "en-US";
  const generation = useStudioVideoGeneration(userId, token);
  const fieldId = useId();
  const [models, setModels] = useState<VideoModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState(request.prompt);
  const [duration, setDuration] = useState(request.duration ?? 5);
  const [resolution, setResolution] = useState("720p");
  const [ratio, setRatio] = useState(request.aspectRatio ?? "16:9");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const state = generation.state;
  const lock = useRef(false);
  const scope = useMemo(() => ({ runtime, active: false }), [runtime]);
  useEffect(() => {
    scope.active = true;
    lock.current = false;
    setImporting(false);
    setImported("");
    setPreview("");
    setError("");
    return () => {
      scope.active = false;
    };
  }, [scope]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: catalogRevision reloads models after an explicit retry.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void fetchVideoModels()
      .then((reply) => {
        if (alive) {
          const available = reply.models.filter(
            (item) =>
              item.accessible !== false &&
              item.capabilities?.textToVideo !== false,
          );
          setModels(available);
          setModel((current) =>
            available.some((item) => item.id === current)
              ? current
              : available[0]?.id || "",
          );
          setError("");
        }
      })
      .catch((cause) => {
        if (alive) setError(cause.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [catalogRevision]);
  const selected = models.find((item) => item.id === model);
  const seconds =
    selected?.limits?.allowedDurations ??
    [5, 8, 10].filter(
      (value) => value <= (selected?.limits?.maxDuration ?? 10),
    );
  const resolutions: string[] = selected?.resolutionRates?.map(
    (rate) => rate.resolution,
  ) ?? [selected?.limits?.maxResolution ?? "720p"];
  const selectedDuration = seconds.includes(duration)
    ? duration
    : (seconds[0] ?? 5);
  const selectedResolution = resolutions.includes(resolution)
    ? resolution
    : (resolutions[0] ?? "720p");
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function importGenerated() {
    const editor = scope.runtime;
    if (
      !scope.active ||
      lock.current ||
      !editor ||
      state?.phase !== "succeeded" ||
      !state.assetId
    )
      return;
    lock.current = true;
    setImporting(true);
    setError("");
    try {
      if (editor.projectId() !== compositionId)
        throw new Error("请切回原视频工程再导入生成素材。");
      let file = await editor.readAsset(state.assetId);
      if (!scope.active) return;
      if (!file) {
        file = await readStudioAsset(token, state.assetId);
        if (!scope.active) return;
      }
      if (editor.projectId() !== compositionId)
        throw new Error("视频已切换，生成素材保留在素材库。");
      await editor.importAsset(file, state.assetId);
      if (!scope.active) return;
      setPreview(URL.createObjectURL(file));
      const entry = editor
        .listMedia()
        .find((item) => item.name.startsWith(`generated-${state.assetId}-`));
      if (!entry) throw new Error("编辑器未登记素材，请刷新核对。");
      setImported(state.assetId);
      await onImported(entry.name);
    } catch (cause) {
      if (scope.active)
        setError(cause instanceof Error ? cause.message : "生成素材取回失败");
    } finally {
      if (scope.active) {
        lock.current = false;
        setImporting(false);
      }
    }
  }
  const busy = generation.busy || importing;
  return (
    <section
      aria-label={english ? "Generate video material" : "对话生成素材"}
      className="space-y-3 rounded-xl border bg-background p-3"
    >
      <h3 className="text-sm font-medium">
        {english ? "Generate a shot" : "生成视频镜头"}
      </h3>
      {!state ? (
        <>
          <label htmlFor={`${fieldId}-prompt`} className="block text-xs">
            {english ? "Shot description" : "镜头描述"}
            <textarea
              id={`${fieldId}-prompt`}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded border bg-background p-2 text-base sm:text-sm"
            />
          </label>
          <label htmlFor={`${fieldId}-model`} className="block text-xs">
            {english ? "Model" : "视频模型"}
            <AppSelect
              id={`${fieldId}-model`}
              aria-label="视频模型"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={loading}
              className="mt-1 w-full rounded border bg-background p-2 text-base sm:text-sm"
            >
              {!models.length && (
                <option>{loading ? "加载模型…" : "暂无可用模型"}</option>
              )}
              {models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </AppSelect>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label htmlFor={`${fieldId}-duration`} className="text-xs">
              {english ? "Seconds" : "时长"}
              <AppSelect
                id={`${fieldId}-duration`}
                aria-label="生成时长"
                value={selectedDuration}
                onChange={(event) => setDuration(Number(event.target.value))}
                className="mt-1 w-full rounded border bg-background p-2"
              >
                {seconds.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </AppSelect>
            </label>
            <label htmlFor={`${fieldId}-resolution`} className="text-xs">
              {english ? "Resolution" : "分辨率"}
              <AppSelect
                id={`${fieldId}-resolution`}
                value={selectedResolution}
                onChange={(event) => setResolution(event.target.value)}
                className="mt-1 w-full rounded border bg-background p-2"
              >
                {resolutions.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </AppSelect>
            </label>
          </div>
          <label htmlFor={`${fieldId}-ratio`} className="block text-xs">
            {english ? "Aspect ratio" : "画幅"}
            <AppSelect
              id={`${fieldId}-ratio`}
              value={ratio}
              onChange={(event) =>
                setRatio(event.target.value as "16:9" | "9:16")
              }
              className="ml-2 rounded border bg-background p-2"
            >
              <option>16:9</option>
              <option>9:16</option>
            </AppSelect>
          </label>
          <p className="text-xs text-muted-foreground">
            {english
              ? "Review the exact charge before this task starts."
              : "先查询本次精确费用，确认后才创建生成任务。"}
          </p>
          <Button
            className="w-full"
            disabled={busy || loading || !model || !prompt.trim()}
            onClick={() =>
              void generation.start({
                prompt,
                model,
                duration: selectedDuration,
                resolution: selectedResolution,
                aspectRatio: ratio,
                requireConfirmation: true,
              })
            }
          >
            {english ? "Review generation cost" : "查看本次生成费用"}
          </Button>
        </>
      ) : (
        <>
          <p className="text-xs leading-5">{state.request.draft.prompt}</p>
          <p className="text-xs text-muted-foreground">
            {state.request.draft.model} · {state.request.draft.duration}s ·{" "}
            {state.request.draft.resolution}
          </p>
          {state.phase === "approval" && state.request.approval && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">
                {state.request.approval.estimatedCredits}{" "}
                {english ? "credits" : "积分"}
              </p>
              <div className="flex gap-2">
                <Button disabled={busy} onClick={generation.approve}>
                  {english ? "Confirm charge and generate" : "确认费用并生成"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={generation.cancel}
                >
                  {english ? "Reject" : "拒绝"}
                </Button>
              </div>
            </div>
          )}
          {state.phase === "draft" && (
            <Button disabled={busy} onClick={generation.resume}>
              {english ? "Recover original request" : "恢复原请求"}
            </Button>
          )}
          {state.phase === "reservation" && (
            <div className="space-y-2">
              <output className="block text-xs">
                {english
                  ? "The original task is waiting for its credit reservation. The model has not started."
                  : state.message}
              </output>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={generation.resume}>
                  {english ? "Resume this reservation" : "恢复本次预扣"}
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={generation.cancel}
                >
                  {english ? "Cancel task" : "取消任务"}
                </Button>
              </div>
            </div>
          )}
          {state.phase === "running" && (
            <>
              <output className="block text-xs">{state.message}</output>
              <Button
                disabled={busy}
                variant="outline"
                onClick={generation.cancel}
              >
                {english ? "Cancel generation" : "取消生成"}
              </Button>
            </>
          )}
          {state.phase === "cancel_requested" && (
            <output className="block rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
              {state.message}
            </output>
          )}
          {state.phase === "settlement_review" &&
            state.settlementReview &&
            state.request.jobId && (
              <JobSettlementReview
                userId={userId}
                token={token}
                jobId={state.request.jobId}
                review={state.settlementReview}
                onUpdated={generation.refresh}
              />
            )}
          {state.phase === "succeeded" && (
            <>
              <p className="text-xs">
                {state.message ||
                  (english
                    ? "Saved to your private library."
                    : "已生成并保存到私有素材库。")}
              </p>
              <Button
                disabled={busy || imported === state.assetId}
                onClick={() => void importGenerated()}
              >
                {imported === state.assetId
                  ? english
                    ? "Imported"
                    : "已导入工程"
                  : english
                    ? "Import result"
                    : "取回并导入工程"}
              </Button>
              {preview && (
                <video
                  src={preview}
                  controls
                  className="max-h-48 w-full rounded"
                />
              )}
            </>
          )}
          {["failed", "canceled"].includes(state.phase) && (
            <output className="block text-xs">{state.message}</output>
          )}
          {["succeeded", "failed", "canceled"].includes(state.phase) && (
            <Button variant="ghost" disabled={busy} onClick={generation.reset}>
              {english ? "Prepare another shot" : "准备下一段素材"}
            </Button>
          )}
        </>
      )}
      {(error || generation.error) && (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>{error || generation.error}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={
              state
                ? generation.refresh
                : () => setCatalogRevision((value) => value + 1)
            }
          >
            {state
              ? english
                ? "Refresh task"
                : "重新查询任务"
              : english
                ? "Reload models"
                : "重新加载模型"}
          </Button>
        </div>
      )}
    </section>
  );
}
