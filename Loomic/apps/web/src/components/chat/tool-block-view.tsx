"use client";

import { motion } from "framer-motion";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ToolBlock } from "@helstera/shared";
import { useAuth } from "../../lib/auth-context";
import { fetchJob, fetchJobs, fetchJobTimeline } from "../../lib/server-api";
import { canRetryGeneration, formatGenerationError, shouldFailoverVideoError } from "../../lib/generation-error-policy";
import { ChatImage } from "./image-lightbox";
import { AgentWorkflowCard } from "./agent-workflow-card";
import { GenerationApprovalCard } from "./generation-approval-card";
import {
  formatModelDisplayName,
  formatOutputPreview,
  formatParamName,
  formatParamValue,
  getToolConfig,
  isHumanReadable,
} from "./utils";

/* ------------------------------------------------------------------ */
/*  ToolIcon                                                           */
/* ------------------------------------------------------------------ */

function ToolIcon({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const cls = className ?? "h-3.5 w-3.5";
  switch (type) {
    case "eye":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
          <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
      );
    case "image":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
        </svg>
      );
    case "video":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      );
    case "palette":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.88 2.88M6.75 17.25h.008v.008H6.75v-.008Z" />
        </svg>
      );
    case "search":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
      );
    case "brush":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42" />
        </svg>
      );
    default:
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437" />
        </svg>
      );
  }
}

/* ------------------------------------------------------------------ */
/*  findSidebarRect — locate the chatbar container for panel placement */
/* ------------------------------------------------------------------ */

function findSidebarRect(el: HTMLElement | null): DOMRect | null {
  let node = el;
  while (node) {
    if (node.style.width && node.classList.contains("shrink-0")) {
      return node.getBoundingClientRect();
    }
    node = node.parentElement;
  }
  return null;
}

type GenerationJob = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled" | "dead_letter";
  job_type: "image_generation" | "video_generation";
  payload: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  error_message: string | null;
  error_code?: string | null;
  progress: number;
  stage: string | null;
  updated_at: string;
  result?: {
    signed_url?: string;
    video_url?: string;
    url?: string;
    width?: number;
    height?: number;
    mime_type?: string;
    model?: string;
    routing?: MediaRouting;
  } | null;
};

type MediaRouting = {
  requestedModels?: string[];
  preferredModel?: string;
  selectedModel?: string;
  fallback?: boolean;
  reason?: string | null;
  inputImage?: boolean;
  duration?: number;
  resolution?: string;
};

type JobPollingState = "pending" | "synced" | "unknown";

function getMediaRouting(job: GenerationJob | null): MediaRouting | null {
  const resultRouting = job?.result?.routing;
  if (resultRouting && typeof resultRouting === "object") {
    const hasInputImage = [job?.payload?.input_images, job?.payload?.input_asset_ids].some((value) => Array.isArray(value) && value.length > 0);
    return { ...resultRouting, inputImage: resultRouting.inputImage ?? hasInputImage };
  }

  const payloadRouting = job?.payload?.routing;
  if (payloadRouting && typeof payloadRouting === "object") {
    const routing = payloadRouting as MediaRouting;
    const hasInputImage = [job?.payload?.input_images, job?.payload?.input_asset_ids].some((value) => Array.isArray(value) && value.length > 0);
    return { ...routing, inputImage: routing.inputImage ?? hasInputImage };
  }

  const model = job?.result?.model ?? (typeof job?.payload?.model === "string" ? job.payload.model : undefined);
  const inputImage = [job?.payload?.input_images, job?.payload?.input_asset_ids]
    .some((value) => Array.isArray(value) && value.length > 0);
  return model ? { selectedModel: model, inputImage } : inputImage ? { inputImage } : null;
}

function useGenerationJobStatus(
  active: boolean,
  toolName: string,
  input: Record<string, unknown> | undefined,
  output: Record<string, unknown> | undefined,
  confirmedJobId?: string,
) {
  const { session } = useAuth();
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [pollingState, setPollingState] = useState<JobPollingState>("pending");

  useEffect(() => {
    if (!active || !session?.access_token) return;

    const jobType = toolName === "generate_video" ? "video_generation" : "image_generation";
    const outputJobId = confirmedJobId ?? (typeof output?.jobId === "string" ? output.jobId : undefined);
    let stopped = false;
    let timer: number | undefined;
    let errorCount = 0;
    const terminalStatuses = new Set(["succeeded", "failed", "canceled", "dead_letter"]);
    const schedule = (delay: number) => {
      if (!stopped) timer = window.setTimeout(() => void load(), delay);
    };
    const load = async () => {
      try {
        const matched = outputJobId
          ? (await fetchJob(session.access_token, outputJobId)).job
          : input?.prompt
            ? (await fetchJobs(session.access_token)).jobs.find((candidate) =>
                candidate.job_type === jobType && candidate.payload.prompt === input.prompt,
              )
            : undefined;
        if (stopped) return;
        if (matched) {
          const next = matched as GenerationJob;
          setJob(next);
          setPollingState("synced");
          errorCount = 0;
          if (terminalStatuses.has(next.status)) return;
        }
        schedule(2_000);
      } catch {
        // The visible tool state remains useful when status polling is transiently unavailable.
        errorCount += 1;
        if (errorCount >= 3) setPollingState("unknown");
        schedule(Math.min(2_000 * 2 ** errorCount, 30_000));
      }
    };

    void load();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, confirmedJobId, input?.prompt, output?.jobId, session?.access_token, toolName]);

  return { job, pollingState };
}

/* ------------------------------------------------------------------ */
/*  ToolBlockView — main card in chatbar + floating detail panel       */
/* ------------------------------------------------------------------ */

export const ToolBlockView = React.memo(function ToolBlockView({
  block,
  hideApprovalCard = false,
  hideDuplicateJob = false,
}: {
  block: ToolBlock;
  hideApprovalCard?: boolean | undefined;
  hideDuplicateJob?: boolean | undefined;
}) {
  const { session } = useAuth();
  const [panelOpen, setPanelOpen] = useState(false);
  const [timeline, setTimeline] = useState<Array<{ key: string; label: string; status: "done" | "active" | "failed" | "pending"; at?: string; id?: string; detail?: string }>>([]);
  const [panelRight, setPanelRight] = useState(416);
  const [confirmedJobId, setConfirmedJobId] = useState<string>();
  const containerRef = useRef<HTMLDivElement>(null);

  const config = getToolConfig(block.toolName);
  const isCompleted = block.status === "completed";
  const hasOutput = block.output && Object.keys(block.output).length > 0;
  const hasInput = block.input && Object.keys(block.input).length > 0;
  const hasDetails = hasOutput || hasInput;

  const cardTitle =
    block.outputSummary && isHumanReadable(block.outputSummary)
      ? block.outputSummary
      : config.label;

  const previewLines = hasOutput
    ? formatOutputPreview(block.output!)
    : [];
  const showCard =
    config.showCard &&
    isCompleted &&
    (block.outputSummary || hasOutput);

  // Extract artifacts for generate_image / generate_video inline preview
  let imageArtifact = block.artifacts?.find((a: { type: string }) => a.type === "image");
  const isImageTool = block.toolName === "generate_image";
  const isVideoTool = block.toolName === "generate_video";
  const isMediaTool = isImageTool || isVideoTool;
  const inputData = block.input as Record<string, unknown> | undefined;
  const modelName = inputData?.model as string | undefined;
  const aspectRatio =
    (inputData?.aspectRatio as string) ?? (isVideoTool ? "16:9" : "1:1");
  const { job: generationJob, pollingState } = useGenerationJobStatus(
    isMediaTool && !hideDuplicateJob && (!isCompleted || Boolean((block.output as Record<string, unknown> | undefined)?.jobId) || Boolean(confirmedJobId)),
    block.toolName,
    inputData,
    block.output as Record<string, unknown> | undefined,
    confirmedJobId,
  );
  const mediaRouting = isMediaTool ? getMediaRouting(generationJob) : null;
  const actualModelName = mediaRouting?.selectedModel ?? modelName;
  // A timed-out agent response can still finish in the background. The live
  // job state is authoritative and must replace the stale timeout message.
  const lateSuccess = isMediaTool && generationJob?.status === "succeeded";
  const backgroundPending = isMediaTool && (
    generationJob?.status === "queued" || generationJob?.status === "running" ||
    (!generationJob && block.output?.pending === true) ||
    pollingState === "unknown"
  );
  if (isImageTool && lateSuccess && !imageArtifact && generationJob?.result?.signed_url) {
    imageArtifact = {
      type: "image", url: generationJob.result.signed_url, jobId: generationJob.id,
      width: generationJob.result.width ?? 1024, height: generationJob.result.height ?? 1024,
      mimeType: generationJob.result.mime_type ?? "image/png",
      title: typeof generationJob.payload.title === "string" ? generationJob.payload.title : "生成图片",
    };
  }
  const terminalFailure = generationJob && ["failed", "dead_letter", "canceled"].includes(generationJob.status);
  const outputErrorCode = (block.output as Record<string, unknown> | undefined)?.errorCode;
  const mediaErrorCode = typeof outputErrorCode === "string"
    ? outputErrorCode
    : generationJob?.error_code ?? undefined;
  const mediaError =
    isMediaTool && isCompleted && !imageArtifact && !lateSuccess && !backgroundPending && pollingState !== "unknown"
      ? terminalFailure
        ? generationJob.error_message ?? "生成任务未完成，请查看任务详情。"
        : ((block.output as Record<string, unknown> | undefined)?.error as string | undefined)
      : undefined;
  const approvalOutput = (block.output as Record<string, unknown> | undefined) ?? {};
  const workflowId = typeof approvalOutput.workflowId === "string"
    ? approvalOutput.workflowId
    : typeof approvalOutput.workflow_id === "string"
      ? approvalOutput.workflow_id
      : undefined;
  const requiresApproval = approvalOutput.status === "confirmation_required"
    && typeof approvalOutput.approvalId === "string";
  const hasLegacyApprovalSummary = typeof block.outputSummary === "string"
    && /confirmation required before credits are charged/i.test(block.outputSummary);
  const isLegacyVideoApproval = isVideoTool
    && !requiresApproval
    && (approvalOutput.status === "confirmation_required" || hasLegacyApprovalSummary);
  const videoUrl = generationJob?.result?.signed_url ?? generationJob?.result?.video_url ?? generationJob?.result?.url;

  useEffect(() => {
    if (!generationJob?.id || !session?.access_token || !isMediaTool) {
      setTimeline([]);
      return;
    }
    let stopped = false;
    const loadTimeline = async () => {
      try {
        const next = await fetchJobTimeline(session.access_token, generationJob.id);
        if (!stopped) setTimeline(next.events);
      } catch {
        // Optional timeline failures do not affect job status.
      }
    };
    void loadTimeline();
    const timer = window.setInterval(() => void loadTimeline(), 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [generationJob?.id, isMediaTool, session?.access_token]);

  const handleOpenPanel = useCallback(() => {
    const rect = findSidebarRect(containerRef.current);
    if (rect) {
      setPanelRight(Math.max(12, Math.min(window.innerWidth - 12, window.innerWidth - rect.left + 12)));
    }
    setPanelOpen(true);
  }, []);

  const handleClosePanel = useCallback(() => setPanelOpen(false), []);

  if (hideDuplicateJob) return null;

  return (
    <div ref={containerRef} className="space-y-1.5">
      {workflowId ? <AgentWorkflowCard workflowId={workflowId} /> : null}
      {requiresApproval && !hideApprovalCard ? (
        <GenerationApprovalCard
          approvalId={approvalOutput.approvalId as string}
          jobType={approvalOutput.jobType === "image_generation" ? "image_generation" : "video_generation"}
          model={typeof approvalOutput.model === "string" ? approvalOutput.model : actualModelName ?? "未指定模型"}
          estimatedCredits={typeof approvalOutput.estimatedCredits === "number" ? approvalOutput.estimatedCredits : 0}
          {...(typeof approvalOutput.duration === "number" ? { duration: approvalOutput.duration } : {})}
          {...(typeof approvalOutput.resolution === "string" ? { resolution: approvalOutput.resolution } : {})}
          hasReferenceImage={approvalOutput.hasReferenceImage === true}
          expiresAt={typeof approvalOutput.expiresAt === "string" ? approvalOutput.expiresAt : new Date(0).toISOString()}
          onJobCreated={setConfirmedJobId}
        />
      ) : null}
      {isLegacyVideoApproval ? (
        <div role="status" className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
          <div className="font-medium text-foreground">{"\u5386\u53f2\u786e\u8ba4\u5df2\u5931\u6548"}</div>
          <p className="mt-1">{"\u5386\u53f2\u786e\u8ba4\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u53d1\u8d77\u89c6\u9891\u751f\u6210\u3002"}</p>
        </div>
      ) : null}
      {/* Layer 1: Status line */}
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {block.status === "running" ? (
          <div className="h-3.5 w-3.5 animate-spin rounded-full border border-muted-foreground/40/30 border-t-muted-foreground" />
        ) : (
          <svg
            className="h-3.5 w-3.5 text-muted-foreground"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
          </svg>
        )}
        <span className="font-medium text-muted-foreground truncate">
          {isMediaTool && actualModelName
            ? formatModelDisplayName(actualModelName)
            : config.label}
        </span>
      </div>

      {/* Layer 2a: Media generation shimmer placeholder */}
      {isMediaTool && (!isCompleted || backgroundPending) && (
        <MediaShimmer
          isVideoTool={isVideoTool}
          aspectRatio={aspectRatio}
          modelName={actualModelName}
          job={generationJob}
          routing={mediaRouting}
          pollingState={pollingState}
        />
      )}

      {/* Layer 2b-err: Media generation failed */}
      {isMediaTool && isCompleted && !imageArtifact && mediaError && (
        <MediaErrorCard
          isVideoTool={isVideoTool}
          error={mediaError}
          routing={mediaRouting}
          {...(typeof inputData?.prompt === "string" ? { prompt: inputData.prompt } : {})}
          canRetry={Boolean(terminalFailure)}
          {...(mediaErrorCode ? { errorCode: mediaErrorCode } : {})}
        />
      )}

      {isMediaTool && isCompleted && !imageArtifact && lateSuccess && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-300">
          {isVideoTool ? "视频" : "图片"}已生成并同步到画布
        </div>
      )}

      {isVideoTool && isCompleted && lateSuccess && videoUrl && (
        <video controls playsInline preload="metadata" src={videoUrl} className="w-full max-h-[420px] rounded-xl border border-border/40 bg-black" aria-label="Generated video" />
      )}

      {isMediaTool && generationJob && timeline.length > 0 ? <JobTimeline events={timeline} /> : null}

      {/* Layer 2b: Image generation card with inline preview */}
      {isImageTool && isCompleted && imageArtifact ? (
        <ImageArtifactCard
          artifact={{
            url: imageArtifact.url,
            type: imageArtifact.type,
            ...(imageArtifact.title !== undefined ? { title: imageArtifact.title } : {}),
            ...(imageArtifact.width !== undefined ? { width: imageArtifact.width } : {}),
            ...(imageArtifact.height !== undefined ? { height: imageArtifact.height } : {}),
            ...(imageArtifact.mimeType !== undefined ? { mimeType: imageArtifact.mimeType } : {}),
            ...(imageArtifact.placement !== undefined ? { placement: imageArtifact.placement } : {}),
            ...(imageArtifact.jobId !== undefined ? { jobId: imageArtifact.jobId } : {}),
          }}
          cardTitle={cardTitle}
          modelName={actualModelName}
          routing={mediaRouting}
          hasDetails={!!hasDetails}
          onOpenPanel={handleOpenPanel}
        />
      ) : showCard && !isMediaTool && !requiresApproval && !hideApprovalCard && !isLegacyVideoApproval && !lateSuccess && !backgroundPending ? (
        /* Layer 2: Generic output card (non-image tools) */
        <div className="rounded-xl border border-border/40 p-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 rounded-lg bg-muted p-1.5 text-muted-foreground">
              <ToolIcon type={config.icon} className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground line-clamp-1">
                {cardTitle}
              </div>
              {previewLines.length > 0 && (
                <div className="mt-0.5 space-y-px">
                  {previewLines.map((line, i) => (
                    <div
                      key={i}
                      className="text-[11px] text-muted-foreground truncate"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {hasDetails && (
            <button
              type="button"
              onClick={handleOpenPanel}
              className="mt-2 flex items-center gap-0.5 text-[12px] text-muted-foreground hover:text-foreground transition-all duration-300 cursor-pointer"
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M9.78 11.78a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 0-1.06l3.5-3.5a.75.75 0 0 1 1.06 1.06L6.56 8l3.22 3.22a.75.75 0 0 1 0 1.06Z" />
              </svg>
              查看详情
            </button>
          )}
        </div>
      ) : null}

      {/* Floating detail panel */}
      {panelOpen &&
        hasDetails &&
        createPortal(
          <ToolDetailPanel
            block={block}
            rightOffset={panelRight}
            onClose={handleClosePanel}
          />,
          document.body,
        )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
function JobTimeline({ events }: { events: Array<{ key: string; label: string; status: "done" | "active" | "failed" | "pending"; at?: string; id?: string; detail?: string }> }) {
  return <div className="rounded-xl border border-border/40 bg-background/30 px-3 py-2">
    <div className="mb-2 text-[11px] font-medium text-muted-foreground">Generation timeline</div>
    <div className="grid gap-1.5 sm:grid-cols-2">
      {events.map((event) => <div key={event.key} className="flex min-w-0 items-center gap-2 text-[11px]">
        <span className={`size-2 shrink-0 rounded-full ${event.status === "done" ? "bg-emerald-500" : event.status === "failed" ? "bg-destructive" : event.status === "active" ? "animate-pulse bg-amber-500" : "bg-muted-foreground/30"}`} />
        <span className="truncate text-foreground">{event.label}</span>
        {event.detail ? <span className="truncate text-muted-foreground">{event.detail}</span> : null}
      </div>)}
    </div>
  </div>;
}

/*  MediaShimmer — shimmer placeholder during media generation         */
/* ------------------------------------------------------------------ */

const MediaShimmer = React.memo(function MediaShimmer({
  isVideoTool,
  aspectRatio,
  modelName,
  job,
  routing,
  pollingState,
}: {
  isVideoTool: boolean;
  aspectRatio: string;
  modelName: string | undefined;
  job: GenerationJob | null;
  routing: MediaRouting | null;
  pollingState: JobPollingState;
}) {
  const status = job?.status;
  const isQueued = status === "queued";
  const isFailed = status === "failed" || status === "dead_letter" || status === "canceled";
  const isSucceeded = status === "succeeded";
  const statusText = isFailed
    ? "任务已失败"
    : pollingState === "unknown"
      ? "状态暂时无法确认，正在重试"
    : isSucceeded
      ? "生成完成，画布已同步"
    : isQueued
      ? "已进入队列，等待工作线程"
      : status === "running"
        ? "模型正在生成"
          : isVideoTool
          ? "视频生成中..."
          : "图片生成中...";
  const progress = Math.max(0, Math.min(100, job?.progress ?? 0));
  const lastUpdate = job?.updated_at
    ? Math.max(0, Math.round((Date.now() - new Date(job.updated_at).getTime()) / 1000))
    : null;
  const isStale = lastUpdate !== null && lastUpdate >= 90 && !isFailed && !isSucceeded;

  return (
    <div className="rounded-xl border border-border/40 overflow-hidden">
      <div
        className="relative w-full max-h-[280px] overflow-hidden"
        style={{ aspectRatio: aspectRatio.replace(":", " / ") }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center glass-soft">
          {isVideoTool ? (
            <svg
              className="h-10 w-10 text-muted-foreground/50"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          ) : (
            <svg
              className="h-10 w-10 text-muted-foreground/50"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
          )}
        </div>
        {/* Shimmer scan effect */}
        <div className="absolute inset-0 animate-shimmer-scan">
          <div
            className="h-full w-1/2"
            style={{
              background:
                "linear-gradient(110deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)",
            }}
          />
        </div>
      </div>
      <div className="px-3 py-2">
        <div role={isFailed ? "alert" : "status"} aria-live={isFailed ? "assertive" : "polite"} aria-atomic="true" className={`text-[12px] font-medium ${isFailed ? "text-destructive" : "text-muted-foreground/70"}`}>
          {statusText}
        </div>
        {job ? (
          <div className="mt-1 space-y-1.5 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between gap-2" aria-label="生成任务进度">
              <span className="truncate">{job.stage ?? `真实状态：${job.status}`}</span>
              <span className="shrink-0 tabular-nums" aria-label={`进度 ${progress}%`}>{progress}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${isFailed ? "bg-destructive" : "bg-foreground/60"}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>{isStale ? "等待工作线程更新" : "实时状态已同步"}</span>
              {job.attempt_count > 0 && <span>尝试 {job.attempt_count}/{job.max_attempts}</span>}
            </div>
          </div>
        ) : (
          <div className="mt-1 space-y-1.5 text-[11px] text-muted-foreground">
            <div>正在提交任务...</div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-foreground/50" />
            </div>
          </div>
        )}
        {isFailed && job?.error_message && (
          <p className="mt-1 line-clamp-2 text-[11px] text-destructive/80">{job.error_message}</p>
        )}
        {modelName && (
          <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
            {formatModelDisplayName(modelName)}
          </div>
        )}
        {routing?.selectedModel && (
          <RoutingNotice routing={routing} />
        )}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  MediaErrorCard                                                     */
/* ------------------------------------------------------------------ */

const MediaErrorCard = React.memo(function MediaErrorCard({
  isVideoTool,
  error,
  routing,
  prompt,
  canRetry,
  errorCode,
}: {
  isVideoTool: boolean;
  error: string;
  routing: MediaRouting | null;
  prompt?: string;
  canRetry: boolean;
  errorCode?: string;
}) {
  const mediaType = isVideoTool ? "video" : "image";
  const retryAllowed = canRetryGeneration(errorCode, canRetry);
  const visibleError = formatGenerationError(errorCode, error);
  const showFailover = isVideoTool && (errorCode == null || shouldFailoverVideoError(errorCode));
  const openModels = useCallback(() => {
    window.dispatchEvent(new CustomEvent("helstera:open-model-preference", { detail: { mediaType } }));
  }, [mediaType]);
  const openFailover = useCallback(() => {
    window.dispatchEvent(new CustomEvent("helstera:model-failover", { detail: { mediaType, prompt, currentModel: routing?.selectedModel } }));
  }, [mediaType, prompt, routing?.selectedModel]);
  const useAutoRouting = useCallback(() => {
    const storageKey = isVideoTool
      ? "helstera:video-model-preference"
      : "helstera:image-model-preference";
    let current: { models?: string[]; duration?: number } = {};
    try {
      current = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as typeof current;
    } catch {
      localStorage.removeItem(storageKey);
    }
    localStorage.setItem(storageKey, JSON.stringify({ ...current, mode: "auto" }));
    window.dispatchEvent(new CustomEvent("helstera:model-preference-changed"));
    window.dispatchEvent(new CustomEvent("helstera:retry-generation", { detail: { prompt, submit: retryAllowed } }));
  }, [isVideoTool, prompt, retryAllowed]);
  const retry = useCallback(() => {
    window.dispatchEvent(new CustomEvent("helstera:retry-generation", { detail: { prompt, submit: true } }));
  }, [prompt]);

  return (
    <div className="rounded-xl border border-destructive/30/30 bg-destructive/5 p-3">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0 rounded-lg bg-destructive/10 p-1.5 text-destructive">
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div role="alert" aria-live="assertive" aria-atomic="true" className="text-sm font-medium text-foreground">
            {isVideoTool ? "\u89c6\u9891\u751f\u6210\u5931\u8d25" : "\u56fe\u7247\u751f\u6210\u5931\u8d25"}
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground line-clamp-2">
            {visibleError}
          </div>
          {routing?.selectedModel && <RoutingNotice routing={routing} />}
          <div className="mt-3 flex flex-wrap gap-2">
            {showFailover && isVideoTool && <button type="button" onClick={openFailover} className="rounded-lg bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-foreground/85">智能容灾：选择下一个模型</button>}
            <button type="button" onClick={openModels} className="rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted">
              重新选择可用模型
            </button>
            <button type="button" onClick={useAutoRouting} disabled={!retryAllowed} aria-describedby={!retryAllowed ? "generation-retry-policy" : undefined} className="rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted">
              使用系统自动路由
            </button>
            <button type="button" onClick={retry} disabled={!retryAllowed || !prompt} aria-describedby="generation-retry-policy" title={retryAllowed ? "重新提交已明确失败的任务" : "任务状态尚未确认失败，已禁用以避免重复扣费"} className="rounded-lg bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-40">
              重新提交任务
            </button>
          </div>
          {!canRetry && (
            <p id="generation-retry-policy" className="mt-2 text-[10px] leading-4 text-muted-foreground">任务尚未确认终止，为避免上游重复受理和重复扣费，暂不允许再次提交。</p>
          )}
        </div>
      </div>
    </div>
  );
});

const RoutingNotice = React.memo(function RoutingNotice({ routing }: { routing: MediaRouting }) {
  const selected = routing.selectedModel ? formatModelDisplayName(routing.selectedModel) : "自动模型";
  const preferred = routing.preferredModel ? formatModelDisplayName(routing.preferredModel) : null;
  return (
    <div className="mt-2 rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] text-muted-foreground">
      <div className="font-medium text-foreground">已使用：{selected}</div>
      {routing.fallback && preferred && (
        <div className="mt-0.5">自动切换：{preferred} → {selected}</div>
      )}
      {routing.reason && <div className="mt-0.5">原因：{routing.reason}</div>}
      <div className="mt-0.5">
        {routing.inputImage ? "参考图已注入" : "无参考图"}
        {routing.duration ? ` · ${routing.duration}秒` : ""}
        {routing.resolution ? ` · ${routing.resolution}` : ""}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  ImageArtifactCard                                                  */
/* ------------------------------------------------------------------ */

const ImageArtifactCard = React.memo(function ImageArtifactCard({
  artifact,
  cardTitle,
  modelName,
  routing,
  hasDetails,
  onOpenPanel,
}: {
  artifact: { url: string; title?: string; type: string; width?: number; height?: number; mimeType?: string; placement?: { x: number; y: number; width: number; height: number }; jobId?: string };
  cardTitle: string;
  modelName: string | undefined;
  routing: MediaRouting | null;
  hasDetails: boolean;
  onOpenPanel: () => void;
}) {
  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      fetch(artifact.url)
        .then((res) => res.blob())
        .then((blob) => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = artifact.title ?? "generated-image.png";
          a.click();
          URL.revokeObjectURL(a.href);
        })
        .catch(() => window.open(artifact.url, "_blank"));
    },
    [artifact.url, artifact.title],
  );

  return (
    <div
      className="group cursor-pointer rounded-xl border border-border/40 overflow-hidden transition-all duration-300 hover:shadow-md"
      onClick={onOpenPanel}
    >
      {/* Image preview */}
      <div className="relative aspect-square max-h-[280px] w-full overflow-hidden glass-soft">
        <img
          src={artifact.url}
          alt={artifact.title ?? "Generated image"}
          className="h-full w-full object-cover transition-all duration-300 duration-500 group-hover:scale-[1.03]"
          loading="lazy"
        />
        {/* Gradient overlay with download button */}
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300">
          <button
            type="button"
            onClick={handleDownload}
            className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-all duration-300"
            title="\u4e0b\u8f7d\u56fe\u7247"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14ZM7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06Z" />
            </svg>
          </button>
        </div>
      </div>
      {/* Title + model info */}
      <div className="px-3 py-2.5">
        <div className="text-sm font-medium text-foreground line-clamp-1">
          {artifact.title ?? cardTitle}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {modelName && (
            <span className="truncate">
              {formatModelDisplayName(modelName)}
            </span>
          )}
          {hasDetails && (
            <>
              <span>&middot;</span>
              <span className="hover:text-foreground transition-all duration-300">
                查看详情
              </span>
            </>
          )}
        </div>
        {routing?.selectedModel && <RoutingNotice routing={routing} />}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  ToolDetailPanel — floating panel to the left of chatbar            */
/* ------------------------------------------------------------------ */

function ToolDetailPanel({
  block,
  rightOffset,
  onClose,
}: {
  block: ToolBlock;
  rightOffset: number;
  onClose: () => void;
}) {
  const [inputExpanded, setInputExpanded] = useState(false);
  const hasInput = block.input && Object.keys(block.input).length > 0;
  const config = getToolConfig(block.toolName);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[1000] bg-black/15 backdrop-blur-[1px]"
      onClick={onClose}
      role="presentation"
    >
      <motion.div
        initial={{ opacity: 0, x: 24, scale: 0.97 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{
          duration: 0.25,
          ease: [0.25, 0.46, 0.45, 0.94],
        }}
        role="dialog"
        aria-modal="false"
        aria-label="工具详情"
        className="fixed top-1/2 -translate-y-1/2 w-[min(520px,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] min-h-[240px] rounded-lg glass-strong shadow-card-hover overflow-hidden flex flex-col"
        style={{ right: rightOffset }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <ToolIcon
              type={config.icon}
              className="h-4 w-4 text-muted-foreground"
            />
            <h3 className="text-sm font-medium text-foreground">
              {config.label}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭工具详情"
            className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground transition-all duration-300 cursor-pointer"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
          {/* Input -- collapsible */}
          {hasInput && (
            <div>
              <button
                type="button"
                onClick={() => setInputExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-all duration-300"
                aria-expanded={inputExpanded}
              >
                <svg
                  className={`h-3 w-3 transition-all duration-300 duration-200 ${inputExpanded ? "rotate-90" : ""}`}
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5a.75.75 0 0 1-1.06-1.06L9.44 8 6.22 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
                输入参数
              </button>
              {inputExpanded && (
                <div className="mt-2 space-y-1.5">
                  {Object.entries(block.input!).map(([key, value]) => (
                    <div key={key} className="rounded-lg bg-muted px-3 py-2">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {formatParamName(key)}
                      </div>
                      <div className="mt-0.5 text-xs text-foreground break-all whitespace-pre-wrap">
                        {formatParamValue(value)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Output */}
          {block.output ? (
            <ToolOutputRenderer
              toolName={block.toolName}
              output={block.output}
            />
          ) : block.outputSummary ? (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">
                输出
              </div>
              <div className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words">
                {block.outputSummary}
              </div>
            </div>
          ) : null}

          {/* Image artifacts */}
          {block.artifacts && block.artifacts.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">
                附件
              </div>
              <div className="flex flex-wrap gap-2">
                {block.artifacts?.map((artifact) =>
                  artifact.type === "image" && "url" in artifact ? (
                    <ChatImage
                      key={artifact.url}
                      src={artifact.url}
                      alt={artifact.title ?? "Generated image"}
                      className="max-w-[200px] rounded-lg border border-border"
                    />
                  ) : null,
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tool-specific output renderers                                     */
/* ------------------------------------------------------------------ */

function ToolOutputRenderer({
  toolName,
  output,
}: {
  toolName: string;
  output: Record<string, unknown>;
}) {
  if (toolName === "prepare_douyin_publish" && isDouyinPublishDraft(output)) {
    return <DouyinPublishDraftOutput data={output} />;
  }
  if (toolName === "get_brand_kit" && isBrandKitOutput(output)) {
    return <BrandKitOutput data={output} />;
  }

  const entries = Object.entries(output);
  const isSimple = entries.every(
    ([, v]) =>
      v === null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean",
  );

  if (isSimple && entries.length > 0) {
    return (
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          输出
        </div>
        <div className="space-y-2.5">
          {entries.map(([key, value]) => (
            <div key={key} className="rounded-lg bg-muted px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {formatParamName(key)}
              </div>
              <div className="mt-0.5 text-sm text-foreground whitespace-pre-wrap break-words">
                {value === null ? "\u2014" : String(value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Complex objects / arrays -- formatted JSON
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-2">
        输出
      </div>
      <div className="rounded-xl bg-muted px-4 py-3 overflow-x-auto max-h-[360px] overflow-y-auto">
        <pre className="text-[12px] leading-5 text-muted-foreground whitespace-pre-wrap break-all font-mono">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    </div>
  );
}

type DouyinPublishDraft = {
  status: "approval_required";
  approvalRequired: true;
  manualOnly: true;
  title: string;
  body: string;
  hashtags: string[];
  coverText: string;
  handoffUrl: string;
  instructions: string;
};

function isDouyinPublishDraft(output: Record<string, unknown>): output is DouyinPublishDraft {
  return output.status === "approval_required" && output.approvalRequired === true && typeof output.handoffUrl === "string";
}

function DouyinPublishDraftOutput({ data }: { data: DouyinPublishDraft }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">抖音发布草稿已准备</p><span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] text-amber-800 dark:text-amber-200">需人工确认</span></div>
      <p className="mt-3 text-sm font-medium">{data.title}</p>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{data.body}</p>
      {data.hashtags.length > 0 && <p className="mt-3 text-xs text-muted-foreground">标签：{data.hashtags.map((tag) => `#${tag}`).join(" ")}</p>}
      {data.coverText && <p className="mt-2 text-xs text-muted-foreground">封面文案：{data.coverText}</p>}
      <p className="mt-3 text-xs leading-5 text-amber-800 dark:text-amber-200">{data.instructions}</p>
      <a href={data.handoffUrl} className="mt-4 inline-flex items-center rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background hover:opacity-90">打开发布审批页</a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  BrandKit output renderer                                           */
/* ------------------------------------------------------------------ */

type BrandKitData = {
  kit_name?: string;
  design_guidance?: string;
  colors?: { name?: string; hex?: string; role?: string | null }[];
  fonts?: {
    name?: string;
    family?: string;
    weight?: string;
    role?: string | null;
  }[];
  logos?: { name?: string; url?: string; role?: string | null }[];
  images?: { name?: string; url?: string; role?: string | null }[];
};

function isBrandKitOutput(
  output: Record<string, unknown>,
): output is BrandKitData {
  return (
    "colors" in output ||
    "fonts" in output ||
    "logos" in output ||
    "kit_name" in output
  );
}

function BrandKitOutput({ data }: { data: BrandKitData }) {
  const colors = data.colors?.filter((c) => c.hex) ?? [];
  const fonts = data.fonts?.filter((f) => f.name) ?? [];
  const logos = data.logos?.filter((l) => l.url) ?? [];
  const images = data.images?.filter((i) => i.url) ?? [];

  return (
    <div className="space-y-4">
      {data.kit_name && (
        <div>
          <div className="text-base font-medium text-foreground">
            {data.kit_name}
          </div>
          {data.design_guidance && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {data.design_guidance}
            </div>
          )}
        </div>
      )}

      {/* Colors */}
      {colors.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Color
          </div>
          <div className="flex flex-wrap gap-3">
            {colors.map((color, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div
                  className="h-16 w-16 rounded-2xl border border-border/60"
                  style={{ backgroundColor: color.hex }}
                />
                <span className="text-[10px] font-medium text-muted-foreground">
                  {color.hex}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fonts */}
      {fonts.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Fonts
          </div>
          <div className="grid grid-cols-2 gap-2">
            {fonts.map((font, i) => (
              <div key={i} className="rounded-xl bg-muted px-3 py-3">
                <div className="text-[10px] text-muted-foreground mb-1">
                  {font.name}
                </div>
                <div
                  className="text-sm text-foreground"
                  style={{ fontFamily: font.family }}
                >
                  ABCDEFGHIJKLM
                </div>
                <div
                  className="text-xs text-foreground mt-0.5"
                  style={{ fontFamily: font.family }}
                >
                  abcdefghijklmnopqrstuvwxyz
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Logos & Images */}
      {(logos.length > 0 || images.length > 0) && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Photography
          </div>
          <div className="grid grid-cols-2 gap-2">
            {logos.map((logo, i) => (
              <div
                key={`logo-${i}`}
                className="overflow-hidden rounded-xl border border-border"
              >
                <img
                  src={logo.url}
                  alt={logo.name ?? "Logo"}
                  className="h-auto w-full object-cover"
                  loading="lazy"
                />
                {logo.name && (
                  <div className="px-2 py-1.5 text-[10px] text-muted-foreground truncate">
                    {logo.name}
                  </div>
                )}
              </div>
            ))}
            {images.map((img, i) => (
              <div
                key={`img-${i}`}
                className="overflow-hidden rounded-xl border border-border"
              >
                <img
                  src={img.url}
                  alt={img.name ?? "Image"}
                  className="h-auto w-full object-cover"
                  loading="lazy"
                />
                {img.name && (
                  <div className="px-2 py-1.5 text-[10px] text-muted-foreground truncate">
                    {img.name}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
