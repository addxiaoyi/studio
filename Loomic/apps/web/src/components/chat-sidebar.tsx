"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useBreakpoint } from "../hooks/use-breakpoint";
import type {
  ContentBlock,
  DesktopExecutionContext,
  ImageArtifact,
  ImageGenerationPreference,
  MessageMention,
  StreamEvent,
  VideoArtifact,
  VideoGenerationPreference,
} from "@helstera/shared";
import { useAgentModel } from "../hooks/use-agent-model";
import { mapServerMessages, useChatSessions } from "../hooks/use-chat-sessions";
import { useChatStream } from "../hooks/use-chat-stream";
import {
  INITIAL_AGENT_MODEL_KEY,
  INITIAL_ATTACHMENTS_KEY,
  INITIAL_IMAGE_GENERATION_PREFERENCE_KEY,
  INITIAL_VIDEO_GENERATION_PREFERENCE_KEY,
} from "../hooks/use-create-project";
import type { ReadyAttachment } from "../hooks/use-image-attachments";
import { useImageAttachments } from "../hooks/use-image-attachments";
import { useImageModelPreference } from "../hooks/use-image-model-preference";
import { useVideoModelPreference } from "../hooks/use-video-model-preference";
import type { WebSocketHandle } from "../hooks/use-websocket";
import { fetchBrandKit } from "../lib/brand-kit-api";
import { uniqueGenerationApprovals } from "../lib/generation-approval-visibility";
import { shouldFailoverVideoError } from "../lib/generation-error-policy";
import { selectRetryReferences, selectVideoReferences } from "../lib/video-reference-policy";
import { confirmLatestGenerationApproval, fetchImageModels, fetchVideoModels, fetchJob, fetchLatestGenerationApproval, fetchPendingGenerationApproval, fetchWorkspaceSkills, generateVideoDirect, saveMessage } from "../lib/server-api";
import type { CanvasSelectedElement } from "./canvas-editor";
import {
  type BrandKitMentionItem,
  type CanvasImageItem,
  type ImageModelMentionItem,
  type SkillMentionItem,
  MessageMentionPicker,
  type MessageMentionPickerItem,
} from "./canvas-image-picker";
import { ChatInput } from "./chat-input";
import { ChatMessage } from "./chat-message";
import { GenerationApprovalCard } from "./chat/generation-approval-card";
import { ChatSkills } from "./chat-skills";
import { CreditInsufficientDialog } from "./credits/credit-insufficient-dialog";
import { useTierLimitToast } from "./credits/tier-limit-toast";
import { useToast } from "./toast";
import { ErrorBoundary } from "./error-boundary";
import { SessionSelector } from "./session-selector";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

// ── Send-time stamps ─────────────────────────────────────────
// Every message bubble carries the moment it was sent. Server history always
// has `created_at`; optimistic messages are stamped with the local clock.

/** ISO timestamp for a message the UI is about to add locally. */
export function nowIso(): string {
  return new Date().toISOString();
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Localized send time for a bubble:
 * - same calendar day  -> `HH:mm`
 * - other day, same y. -> `MM-DD HH:mm`
 * - other year         -> `YYYY-MM-DD HH:mm`
 *
 * Returns `""` for a missing or unparseable value so a bad row degrades to "no
 * timestamp" instead of rendering `Invalid Date`.
 */
export function formatMessageTime(
  createdAt: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!createdAt) return "";
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return "";
  const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  if (sameDay) return time;
  const monthDay = `${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
  if (at.getFullYear() === now.getFullYear()) return `${monthDay} ${time}`;
  return `${at.getFullYear()}-${monthDay} ${time}`;
}

type ChatSidebarProps = {
  accessToken: string;
  canvasId: string;
  open: boolean;
  onToggle: () => void;
  onImageGenerated?: (artifact: ImageArtifact) => void;
  onVideoGenerated?: (artifact: VideoArtifact) => void | Promise<void>;
  onCanvasSync?: () => void;
  /** Called for every stream event — used by job fallback polling to detect timed-out jobs */
  onStreamEvent?: (event: StreamEvent) => void;
  initialPrompt?: string | undefined;
  initialSessionId?: string | undefined;
  onSessionChange?: (sessionId: string) => void;
  onRequestCanvasImages?: () => CanvasImageItem[];
  currentBrandKitId?: string | null;
  ws: WebSocketHandle;
  selectedCanvasElements?: CanvasSelectedElement[];
  desktopExecutionContext?: DesktopExecutionContext;
};

function explicitVideoDuration(text: string): number | undefined {
  const match = text.match(/(?:^|\s)(\d{1,2})\s*(?:s|sec(?:onds)?|秒)(?:\s|$)/i);
  const seconds = match ? Number(match[1]) : NaN;
  return Number.isInteger(seconds) && seconds >= 3 && seconds <= 30 ? seconds : undefined;
}

export function ChatSidebar({
  accessToken,
  canvasId,
  open,
  onToggle,
  onImageGenerated,
  onVideoGenerated,
  onCanvasSync,
  onStreamEvent,
  initialPrompt,
  initialSessionId,
  onSessionChange,
  onRequestCanvasImages,
  currentBrandKitId,
  ws,
  selectedCanvasElements,
  desktopExecutionContext,
}: ChatSidebarProps) {
  const breakpoint = useBreakpoint();
  const isOverlay = breakpoint !== "desktop";
  const [canvasApproval, setCanvasApproval] = useState<Record<string, unknown> | null>(null);
  const [canvasApprovalJob, setCanvasApprovalJob] = useState<{
    id: string;
    jobType: "image_generation" | "video_generation";
    status: string;
    progress: number;
    stage?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let stopped = false;
    const refreshApproval = async () => {
      try {
        const approval = await fetchPendingGenerationApproval(accessToken, canvasId);
        if (!stopped) setCanvasApproval(approval);
      } catch {
        if (!stopped) setCanvasApproval(null);
      }
    };
    void refreshApproval();
    const timer = window.setInterval(() => void refreshApproval(), 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [accessToken, canvasId]);

  useEffect(() => {
    if (!canvasApprovalJob?.id) return;
    let stopped = false;
    let timer: number | undefined;
    const terminalStatuses = new Set(["succeeded", "failed", "dead_letter", "canceled"]);

    const pollJob = async () => {
      try {
        const response = await fetchJob(accessToken, canvasApprovalJob.id);
        if (stopped) return;
        const job = response.job as {
          status?: string;
          progress?: number;
          stage?: string | null;
          error_message?: string | null;
        };
        const status = typeof job.status === "string" ? job.status : "queued";
        setCanvasApprovalJob({
          id: canvasApprovalJob.id,
          jobType: canvasApprovalJob.jobType,
          status,
          progress: typeof job.progress === "number" ? Math.max(0, Math.min(100, job.progress)) : 0,
          ...(typeof job.stage === "string" ? { stage: job.stage } : {}),
          ...(typeof job.error_message === "string" ? { error: job.error_message } : {}),
        });
        if (status === "succeeded") {
          onCanvasSync?.();
          return;
        }
        if (terminalStatuses.has(status)) return;
      } catch {
        if (stopped) return;
      }
      timer = window.setTimeout(() => void pollJob(), 2_000);
    };

    void pollJob();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [accessToken, canvasApprovalJob?.id, onCanvasSync]);

  useEffect(() => {
    if (canvasApprovalJob?.id) return;
    let stopped = false;
    const recoverJob = async () => {
      try {
        const latest = await fetchLatestGenerationApproval(accessToken, canvasId);
        if (!latest || typeof latest.jobId !== "string" || stopped) return;
        const status = typeof latest.jobStatus === "string" ? latest.jobStatus : "queued";
        setCanvasApprovalJob({
          id: latest.jobId,
          jobType: latest.jobType === "video_generation" ? "video_generation" : "image_generation",
          status,
          progress: 0,
          ...(typeof latest.error === "string" ? { error: latest.error } : {}),
        });
        if (status === "succeeded") onCanvasSync?.();
      } catch {
        // Job recovery is best effort; the chat history remains available.
      }
    };
    void recoverJob();
    return () => { stopped = true; };
  }, [accessToken, canvasApprovalJob?.id, canvasId, onCanvasSync]);

  // ── Session & message management (extracted hook with LRU cache) ──
  const {
    sessions,
    sessionsError,
    activeSessionId,
    activeSessionIdRef,
    messages,
    messagesRef,
    setMessages,
    sessionsLoading,
    messagesLoading,
    messagesError,
    streaming,
    setStreaming,
    updateSessionMessages,
    handleSelectSession,
    handleNewChat,
    handleDeleteSession,
    autoTitleSession,
    reloadMessages,
    reloadSessions,
    accessTokenRef,
  } = useChatSessions({
    canvasId,
    accessToken,
    initialSessionId,
    onSessionChange,
  });

  useEffect(() => {
    const refreshAgentResult = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      if (sessionId && sessionId === activeSessionIdRef.current) void reloadMessages(sessionId);
    };
    window.addEventListener("helstera:desktop-agent-result", refreshAgentResult);
    return () => window.removeEventListener("helstera:desktop-agent-result", refreshAgentResult);
  }, [reloadMessages, activeSessionIdRef]);

  // ── Stream event handler (extracted hook, shared between send & reconnect) ──
  const { applyStreamEvent } = useChatStream(updateSessionMessages);

  // ── Mention & attachment state ──
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [messageMentions, setMessageMentions] = useState<MessageMention[]>([]);
  const [brandKitMentionItems, setBrandKitMentionItems] = useState<
    BrandKitMentionItem[]
  >([]);
  const [imageModelMentionItems, setImageModelMentionItems] = useState<
    ImageModelMentionItem[]
  >([]);
  const [skillMentionItems, setSkillMentionItems] = useState<
    SkillMentionItem[]
  >([]);
  const [creditDialog, setCreditDialog] = useState<{
    open: boolean;
    currentBalance: number;
    requiredAmount: number;
  } | null>(null);
  const [modelSelectionDialog, setModelSelectionDialog] = useState<string | null>(null);
  const [modelFailoverDialog, setModelFailoverDialog] = useState<{
    mediaType: "image" | "video";
    prompt: string;
    currentModel?: string;
    candidates: Array<{ id: string; displayName: string; availability?: string; healthStatus?: string }>;
  } | null>(null);
  const [retryingAssistantId, setRetryingAssistantId] = useState<string | null>(null);
  const sendInFlightRef = useRef(false);
  const chatInputRef = useRef<import("./chat-input").ChatInputHandle>(null);

  const initialPromptSent = useRef(false);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const chatCloseButtonRef = useRef<HTMLButtonElement>(null);
  const collapsedTriggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(open);
  const shouldAutoFollowRef = useRef(true);
  const [showLatestButton, setShowLatestButton] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const activeRunIdRef = useRef<string | null>(null);
  const cancelStreamRef = useRef<(() => void) | null>(null);
  const directVideoAbortRef = useRef<AbortController | null>(null);
  const messageMentionsRef = useRef(messageMentions);
  messageMentionsRef.current = messageMentions;
  const selectedCanvasElementsRef = useRef(selectedCanvasElements);
  selectedCanvasElementsRef.current = selectedCanvasElements;
  const prevConnectedRef = useRef(false);

  useEffect(() => {
    if (open && isOverlay) {
      chatCloseButtonRef.current?.focus();
    } else if (!open && wasOpenRef.current) {
      collapsedTriggerRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [isOverlay, open]);

  const {
    attachments: imageAttachments,
    addFiles,
    addCanvasRef,
    retryUpload,
    removeAttachment,
    clearAll: clearAttachments,
    isUploading,
    readyAttachments,
  } = useImageAttachments(accessToken);

  const { activeImageGenerationPreference } = useImageModelPreference();
  const activeImageGenerationPreferenceRef = useRef(
    activeImageGenerationPreference,
  );
  activeImageGenerationPreferenceRef.current = activeImageGenerationPreference;

  const { activeVideoGenerationPreference } = useVideoModelPreference();
  const activeVideoGenerationPreferenceRef = useRef(
    activeVideoGenerationPreference,
  );
  activeVideoGenerationPreferenceRef.current = activeVideoGenerationPreference;

  const { model: agentModel } = useAgentModel();
  const agentModelRef = useRef(agentModel);
  agentModelRef.current = agentModel;

  const { showTierLimit } = useTierLimitToast();
  const { toast: showToast } = useToast();
  const [streamPhase, setStreamPhase] = useState<
    "connecting" | "processing" | "slow" | null
  >(null);
  const slowResponseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Sidebar resize ──
  const SIDEBAR_MIN = 300;
  const SIDEBAR_MAX = 600;
  const SIDEBAR_KEYBOARD_STEP = 20;
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const isResizing = useRef(false);

  const clampWidth = useCallback(
    (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)),
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return;
        const delta = startX - moveEvent.clientX;
        setSidebarWidth(clampWidth(startWidth + delta));
      };

      const handleMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [sidebarWidth, clampWidth],
  );

  // Touch support for resize handle (mobile / tablet)
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      isResizing.current = true;
      const startX = touch.clientX;
      const startWidth = sidebarWidth;

      const handleTouchMove = (moveEvent: TouchEvent) => {
        if (!isResizing.current) return;
        const t = moveEvent.touches[0];
        if (!t) return;
        moveEvent.preventDefault(); // prevent scroll during resize
        const delta = startX - t.clientX;
        setSidebarWidth(clampWidth(startWidth + delta));
      };

      const handleTouchEnd = () => {
        isResizing.current = false;
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleTouchEnd);
        document.removeEventListener("touchcancel", handleTouchEnd);
      };

      document.addEventListener("touchmove", handleTouchMove, { passive: false });
      document.addEventListener("touchend", handleTouchEnd);
      document.addEventListener("touchcancel", handleTouchEnd);
    },
    [sidebarWidth, clampWidth],
  );

  // Keyboard support for resize handle (ArrowLeft/ArrowRight)
  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSidebarWidth((prev) => clampWidth(prev + SIDEBAR_KEYBOARD_STEP));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSidebarWidth((prev) => clampWidth(prev - SIDEBAR_KEYBOARD_STEP));
      }
    },
    [clampWidth],
  );

  // ── Auto-scroll to bottom ──
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const gap = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldAutoFollowRef.current = gap < 96;
    setShowLatestButton(!shouldAutoFollowRef.current && gap > 240);
  }, []);

  useEffect(() => {
    shouldAutoFollowRef.current = true;
    setShowLatestButton(false);
    scrollToBottom();
  }, [activeSessionId, scrollToBottom]);

  useEffect(() => {
    if (shouldAutoFollowRef.current) scrollToBottom();
  }, [messages, scrollToBottom]);
  useEffect(() => {
    if (!canvasApprovalJob?.id) return;
    if (shouldAutoFollowRef.current) scrollToBottom();
  }, [canvasApprovalJob?.id, scrollToBottom]);
  useEffect(() => {
    const handleModelFailover = (event: Event) => {
      const detail = (event as CustomEvent<{ mediaType?: "image" | "video"; prompt?: string; currentModel?: string }>).detail;
      const prompt = detail?.prompt?.trim();
      if (!prompt) return;
      const mediaType = detail.mediaType ?? "video";
      const load = mediaType === "video" ? fetchVideoModels() : fetchImageModels();
      void load.then((data) => {
        const candidates = data.models.filter((model) => model.id !== detail.currentModel).map((model) => ({ id: model.id, displayName: model.displayName, ...(mediaType === "video" && "availability" in model && model.availability ? { availability: model.availability } : {}), ...(mediaType === "video" && "healthStatus" in model && model.healthStatus ? { healthStatus: model.healthStatus } : {}) }));
        setModelFailoverDialog({ mediaType, prompt, ...(detail.currentModel ? { currentModel: detail.currentModel } : {}), candidates });
      }).catch((error) => console.error("[chat] failed to load failover models", error));
    };
    window.addEventListener("helstera:model-failover", handleModelFailover);
    return () => window.removeEventListener("helstera:model-failover", handleModelFailover);
  }, []);


  // ── Fetch image models for @mention picker ──
  useEffect(() => {
    let cancelled = false;

    fetchImageModels()
      .then((data) => {
        if (cancelled) return;
        setImageModelMentionItems(
          data.models.map((model) => ({
            kind: "image-model",
            id: model.id,
            label: model.displayName,
            description: model.description,
            ...(model.iconUrl ? { iconUrl: model.iconUrl } : {}),
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setImageModelMentionItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch enabled workspace skills for @ mention
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    fetchWorkspaceSkills(accessToken)
      .then((data) => {
        if (cancelled) return;
        const allSkills = data.skills ?? [];
        const enabledSkills = allSkills.filter((s) => s.enabled);
        console.log(`[chat-sidebar] Workspace skills loaded: ${allSkills.length} total, ${enabledSkills.length} enabled`);
        setSkillMentionItems(
          enabledSkills.map((s) => ({
            kind: "skill" as const,
            id: s.id,
            label: s.name,
            slug: s.slug,
            description: s.description,
          })),
        );
      })
      .catch((err) => {
        console.error("[chat-sidebar] Failed to load workspace skills:", err);
        if (!cancelled) setSkillMentionItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // ── Fetch brand kit items for @mention picker ──
  useEffect(() => {
    if (!currentBrandKitId) {
      setBrandKitMentionItems([]);
      return;
    }

    let cancelled = false;
    fetchBrandKit(accessTokenRef.current, currentBrandKitId)
      .then((kit) => {
        if (cancelled) return;
        setBrandKitMentionItems(
          kit.assets.map((asset) => ({
            kind: "brand-kit-asset" as const,
            id: asset.id,
            label: asset.display_name,
            assetType: asset.asset_type as "color" | "font" | "logo" | "image",
            ...(asset.text_content !== undefined ? { textContent: asset.text_content } : {}),
            ...(asset.file_url !== undefined ? { fileUrl: asset.file_url } : {}),
            thumbnailUrl:
              asset.asset_type === "logo" || asset.asset_type === "image"
                ? (asset.file_url ?? null)
                : null,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setBrandKitMentionItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, [currentBrandKitId, accessTokenRef]);

  // ── Send message ──
  const sendMessage = useCallback(
    async (
      text: string,
      attachmentsOverride?: ReadyAttachment[],
      imageGenerationPreferenceOverride?: ImageGenerationPreference,
      mentionsOverride?: MessageMention[],
      videoGenerationPreferenceOverride?: VideoGenerationPreference,
    ) => {
      const currentSessionId = activeSessionIdRef.current;
      if (streaming || !currentSessionId) return;

      if (/^(?:确认|确认生成|继续生成)$/u.test(text.trim())) {
        try {
          const confirmed = await confirmLatestGenerationApproval(accessTokenRef.current, canvasId);
          updateSessionMessages(currentSessionId, (prev) => [...prev, {
            id: `assistant-approval-${Date.now()}`,
            role: "assistant" as const,
            contentBlocks: [{ type: "text" as const, text: confirmed.data.jobId ? "已确认扣费，图片任务已开始处理。" : "已确认扣费，图片任务正在启动。" }],
            createdAt: nowIso(),
          }]);
          return;
        } catch {
          // Treat a confirmation word as ordinary chat when no pending approval exists.
        }
      }

      // Merge explicitly-attached images with auto-sensed canvas selection images
      let currentAttachments = attachmentsOverride ?? readyAttachments;
      const selectedEls = selectedCanvasElementsRef.current ?? [];
      const selectedImageEls = selectedEls.filter(
        (el): el is CanvasSelectedElement & { assetId: string } =>
          Boolean(el.type === "image" && el.fileId && el.assetId && (el.storageUrl || el.dataUrl)),
      );
      if (selectedImageEls.length > 0 && !attachmentsOverride) {
        const existingIds = new Set(currentAttachments.map((a) => a.assetId));
        const selectionAttachments: ReadyAttachment[] = selectedImageEls
          .filter((el) => !existingIds.has(el.id))
          .map((el) => ({
            assetId: el.assetId,
            url: el.storageUrl ?? el.dataUrl!,
            mimeType: "image/png",
            source: "canvas-ref" as const,
            name: `Canvas selection ${el.id.slice(0, 6)}`,
          }));
        if (selectionAttachments.length > 0) {
          currentAttachments = [...currentAttachments, ...selectionAttachments];
        }
      }
      const currentVideoGenerationPreference =
        videoGenerationPreferenceOverride ??
        activeVideoGenerationPreferenceRef.current;

      // Explicit video requests with an available image bypass agent tool
      // selection. This keeps slow or stalled chat models from preventing a
      // valid video job from ever reaching the generation backend.
      const videoReferences = currentAttachments.filter((attachment) =>
        attachment.mimeType.startsWith("image/"),
      );
      const requestedDuration = explicitVideoDuration(text);
      const durationFollowUp = requestedDuration != null && videoReferences.length > 0;
      const explicitVideoIntent =
        /\b(video|animate|motion|clip)\b/i.test(text)
        || /(?:视频|动画|动效|转(?:成|为)?视频|变(?:成|为)?视频|做成视频|让.{0,8}动)/i.test(text);
      const wantsVideo = videoReferences.length > 0 && (durationFollowUp || explicitVideoIntent);
      const videoDuration = requestedDuration ?? currentVideoGenerationPreference?.duration ?? 5;
      const videoReference = videoReferences[0];
      // A canvas selection is a visual context, not a request to send every
      // selected image as a multi-reference video input. The first image is
      // the stable first frame for direct image-to-video generation.
      const videoReferencesForGeneration = selectVideoReferences(videoReferences);
      const promptFingerprint = Array.from(text).reduce((hash, char) => ((hash * 31 + char.codePointAt(0)!) >>> 0), 7).toString(36);
      if (wantsVideo && videoReference) {
        const sessionId = activeSessionIdRef.current;
        if (!sessionId) return;
        const videoImageBlocks = videoReferencesForGeneration.map((reference) => ({
          type: "image" as const,
          assetId: reference.assetId,
          url: reference.url,
          mimeType: reference.mimeType,
          source: reference.source,
          ...(reference.name ? { name: reference.name } : {}),
        }));
        const abortController = new AbortController();
        directVideoAbortRef.current = abortController;
        const clientMessageId = crypto.randomUUID();
        const userMessage = {
          id: `user-${Date.now()}`,
          role: "user" as const,
          contentBlocks: [{ type: "text" as const, text }, ...videoImageBlocks],
          createdAt: nowIso(),
        };
        updateSessionMessages(sessionId, (prev) => [...prev, userMessage]);
        void saveMessage(accessTokenRef.current, sessionId, {
          role: "user",
          content: text,
          contentBlocks: [{ type: "text" as const, text }, ...videoImageBlocks],
          clientMessageId,
        }).catch((error) => console.warn("[chat] direct video message save failed", error));

        setStreaming(true);
        setStreamPhase("connecting");
        try {
          setStreamPhase("processing");
          const video = await generateVideoDirect(accessTokenRef.current, text, {
            ...(currentVideoGenerationPreference?.mode === "manual" &&
            currentVideoGenerationPreference.models[0]
              ? { model: currentVideoGenerationPreference.models[0] }
              : {}),
            duration: videoDuration,
            ...(currentVideoGenerationPreference?.resolution ? { resolution: currentVideoGenerationPreference.resolution } : {}),
            aspectRatio: "16:9",
            enableAudio: false,
            inputImages: videoReferencesForGeneration.map((reference) => reference.url),
            inputAssetIds: videoReferencesForGeneration.map((reference) => reference.assetId),
            signal: abortController.signal,
            canvasId,
            sessionId,
            threadId: currentSessionId,
            idempotencyKey: `video:${currentSessionId}:${videoReferencesForGeneration.map((reference) => reference.assetId).join(",")}:${promptFingerprint}:${videoDuration}:${currentVideoGenerationPreference?.models[0] ?? "auto"}:${currentVideoGenerationPreference?.resolution ?? "default"}`,
          });
          if (!onVideoGenerated) {
            throw new Error("画布尚未准备好，请稍后重试。");
          }
          await onVideoGenerated({
            type: "video",
            url: video.url,
            title: "AI生成视频",
            mimeType: video.mimeType,
            width: video.width,
            height: video.height,
            durationSeconds: video.durationSeconds,
          });
          updateSessionMessages(sessionId, (prev) => [
            ...prev,
            {
              id: `assistant-video-${Date.now()}`,
              role: "assistant" as const,
              contentBlocks: [{
                type: "text" as const,
                text: `视频已生成（${video.durationSeconds}秒）并已添加到画布。`,
              }],
              createdAt: nowIso(),
            },
          ]);
        } catch (error) {
          const appError = error as Error & {
            code?: string;
            details?: Record<string, unknown>;
          };
          const message = appError.message || "Video generation failed";
          if (appError.code === "generation_confirmation_required" && appError.details) {
            updateSessionMessages(sessionId, (prev) => [...prev, {
              id: `assistant-video-approval-${Date.now()}`,
              role: "assistant" as const,
              contentBlocks: [{
                type: "tool" as const,
                toolCallId: `video-approval-${Date.now()}`,
                toolName: "generate_video",
                status: "completed" as const,
                input: { prompt: text, duration: videoDuration },
                output: { status: "confirmation_required", ...appError.details },
                outputSummary: "Confirmation required before credits are charged.",
              }],
              createdAt: nowIso(),
            }]);
          } else {
            updateSessionMessages(sessionId, (prev) => [...prev, {
              id: `assistant-video-error-${Date.now()}`,
              role: "assistant" as const,
              contentBlocks: [{ type: "text" as const, text: `Video generation failed: ${message}` }],
              createdAt: nowIso(),
            }]);
          }
        } finally {
          if (directVideoAbortRef.current === abortController) directVideoAbortRef.current = null;
          setStreaming(false);
        }
        return;
      }
      const currentImageGenerationPreference =
        imageGenerationPreferenceOverride ??
        activeImageGenerationPreferenceRef.current;
      const currentMentions = mentionsOverride ?? messageMentionsRef.current;

      // Add user message locally
      const imageBlocks: ContentBlock[] = currentAttachments.map((a) => ({
        type: "image" as const,
        assetId: a.assetId,
        // The local storage adapter returns a relative path; persisted message
        // blocks require an absolute URL for validation and later rendering.
        url: new URL(a.url, window.location.origin).toString(),
        mimeType: a.mimeType,
        source: a.source,
        ...(a.name ? { name: a.name } : {}),
      }));
      const mentionBlocks: ContentBlock[] = currentMentions.map((mention) => {
        if (mention.mentionType === "image-model") {
          return {
            type: "mention" as const,
            mentionType: "image-model" as const,
            id: mention.id,
            label: mention.label,
          };
        }
        if (mention.mentionType === "brand-kit-asset") {
          return {
            type: "mention" as const,
            mentionType: "brand-kit-asset" as const,
            id: mention.id,
            label: mention.label,
            assetType: mention.assetType,
            ...(mention.textContent !== undefined
              ? { textContent: mention.textContent }
              : {}),
            ...(mention.fileUrl !== undefined
              ? { fileUrl: mention.fileUrl }
              : {}),
          };
        }
        return {
          type: "mention" as const,
          mentionType: "skill" as const,
          id: mention.id,
          label: mention.label,
          slug: "default",
        };
      });
      const requestId = crypto.randomUUID();
      const userMsg = {
        id: `user-${Date.now()}`,
        role: "user" as const,
        contentBlocks: [
          { type: "text" as const, text },
          ...mentionBlocks,
          ...imageBlocks,
        ],
        createdAt: nowIso(),
      };
      updateSessionMessages(currentSessionId, (prev) => [...prev, userMsg]);

      // Persist user message (fire-and-forget)
      saveMessage(accessTokenRef.current, currentSessionId, {
        role: "user",
        content: text,
        contentBlocks: [
          { type: "text" as const, text },
          ...mentionBlocks,
          ...imageBlocks,
        ],
        clientMessageId: requestId,
      }).catch((err) =>
        console.error("[chat] Failed to save user message:", err),
      );

      // Auto-title from first user message
      autoTitleSession(text);

      // Create assistant placeholder
      const assistantId = `assistant-${Date.now()}`;
      updateSessionMessages(currentSessionId, (prev) => [
        ...prev,
        { id: assistantId, role: "assistant" as const, contentBlocks: [], createdAt: nowIso() },
      ]);
      setStreaming(true);
      setStreamPhase("connecting");
      abortRef.current = false;

      try {
        const perf = {
          t0Send: performance.now(),
          tAck: 0,
          tFirstToken: 0,
          gotFirstToken: false,
        };

        let resolveStream: () => void;
        const streamDone = new Promise<void>((r) => {
          resolveStream = r;
        });
        const runIdRef = { current: "" };

        const cleanup = ws.onEvent((event) => {
          if (!runIdRef.current || event.runId !== runIdRef.current) return;
          if (abortRef.current) {
            resolveStream();
            return;
          }

          // Track first token timing
          if (!perf.gotFirstToken && event.type === "message.delta") {
            perf.tFirstToken = performance.now();
            perf.gotFirstToken = true;
            setStreamPhase(null);
            console.log(
              `[perf] send → first token: ${(perf.tFirstToken - perf.t0Send).toFixed(0)}ms` +
                ` (ack→token: ${(perf.tFirstToken - perf.tAck).toFixed(0)}ms)`,
            );
          }

          // Billing error: route to appropriate UI, run.canceled will follow
          if (event.type === "billing.error") {
            if (event.code === "insufficient_credits") {
              setCreditDialog({
                open: true,
                currentBalance: event.currentBalance ?? 0,
                requiredAmount: event.requiredAmount ?? 0,
              });
            } else {
              // model_not_accessible, resolution_not_allowed, concurrency_limit
              showTierLimit({ code: event.code, message: event.message });
            }
          }

          if (event.type === "tool.completed") {
            const output = event.output as Record<string, unknown> | undefined;
            if (event.toolName === "generate_video" && shouldFailoverVideoError(output?.errorCode)) {
              const routing = output.routing as { selectedModel?: unknown } | undefined;
              window.dispatchEvent(new CustomEvent("helstera:model-failover", {
                detail: { mediaType: "video", prompt: text, currentModel: typeof routing?.selectedModel === "string" ? routing.selectedModel : activeVideoGenerationPreferenceRef.current.models[0] },
              }));
            }
            if (output?.errorCode === "model_selection_required") {
              setModelSelectionDialog(
                typeof output.error === "string"
                  ? output.error
                  : "你已手动选择模型，本次请求未擅自切换模型。请在模型选择器中更换可用模型，或改为自动路由。",
              );
            }
          }

          // Apply event to messages (single source of truth — shared with reconnect)
          applyStreamEvent(event, assistantId, currentSessionId);

          // Forward event to parent for fallback job polling (timed-out generation recovery)
          onStreamEvent?.(event);

          // Fire canvas insertion callbacks for image/video artifacts.
          // Skip if the backend already inserted the element (elementId in output).
          const backendInserted = event.type === "tool.completed"
            && event.output
            && typeof (event.output as Record<string, unknown>).elementId === "string";
          if (
            event.type === "tool.completed" &&
            event.artifacts &&
            event.toolName !== "screenshot_canvas" &&
            !backendInserted
          ) {
            for (const artifact of event.artifacts) {
              if (artifact.type === "image" && onImageGenerated) {
                onImageGenerated(artifact as ImageArtifact);
              }
              if (artifact.type === "video" && onVideoGenerated) {
                onVideoGenerated(artifact as VideoArtifact);
              }
            }
          }

          if (event.type === "canvas.sync" && onCanvasSync) {
            onCanvasSync();
          }

          // Preview model hint: suggest switching when run fails
          if (event.type === "run.failed") {
            setStreamPhase(null);
            if (event.error.code === "model_selection_required") {
              setModelSelectionDialog(event.error.message);
            }
            if (shouldFailoverVideoError(event.error.code)) {
              window.dispatchEvent(new CustomEvent("helstera:model-failover", {
                detail: { mediaType: "video", prompt: text, currentModel: activeVideoGenerationPreferenceRef.current.models[0] },
              }));
            }
            const failureMessage = event.error.message.trim();
            if (failureMessage) {
              showToast(`生成失败：${failureMessage}`, "error");
            }
            const currentModel = agentModelRef.current ?? "";
            if (currentModel.includes("preview")) {
              showToast(
                "当前 Preview 模型请求不稳定，建议切换模型后重试",
                "error",
              );
            }
          }

          if (
            event.type === "run.completed" ||
            event.type === "run.failed" ||
            event.type === "run.canceled"
          ) {
            resolveStream();
          }
        });
        cancelStreamRef.current = () => {
          cleanup();
          resolveStream();
        };

        // Start run via WebSocket
        const runId = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("WebSocket ack timeout — connection may be down"));
          }, 10_000);

          ws.startRun(
            {
              sessionId: currentSessionId,
               requestId,
              conversationId: canvasId,
              prompt: text,
              canvasId,
              accessToken: accessTokenRef.current,
              ...(currentAttachments.length > 0
                ? { attachments: currentAttachments }
                : {}),
              ...(currentMentions.length > 0
                ? { mentions: currentMentions }
                : {}),
              ...(currentImageGenerationPreference
                ? {
                    imageGenerationPreference: currentImageGenerationPreference,
                  }
                : {}),
              ...(currentVideoGenerationPreference
                ? {
                    videoGenerationPreference: currentVideoGenerationPreference,
                  }
                : {}),
              ...(agentModelRef.current
                ? { model: agentModelRef.current }
                : {}),
              ...(desktopExecutionContext ? { desktopExecutionContext } : {}),
            },
            (ack) => {
              clearTimeout(timeout);
              perf.tAck = performance.now();
              setStreamPhase("processing");
              slowResponseTimer.current = setTimeout(() => {
                if (!perf.gotFirstToken) {
                  setStreamPhase("slow");
                  showToast("模型仍在处理中，响应较慢，请耐心等待。", "info");
                }
              }, 15_000);
              console.log(
                `[perf] send → ack: ${(perf.tAck - perf.t0Send).toFixed(0)}ms`,
              );
              const id = ack.payload.runId as string;
              runIdRef.current = id;
              activeRunIdRef.current = id;
              resolve(id);
            },
          );
        });
        clearAttachments();
        setMessageMentions([]);

        await streamDone;
        if (slowResponseTimer.current) {
          clearTimeout(slowResponseTimer.current);
          slowResponseTimer.current = null;
        }
        setStreamPhase(null);
        cleanup();
        cancelStreamRef.current = null;
        activeRunIdRef.current = null;
      } catch (error) {
        if (slowResponseTimer.current) {
          clearTimeout(slowResponseTimer.current);
          slowResponseTimer.current = null;
        }
        setStreamPhase(null);
        updateSessionMessages(currentSessionId, (prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const hasText = m.contentBlocks.some((b) => b.type === "text");
            if (hasText) return m;
            return {
              ...m,
              contentBlocks: [
                ...m.contentBlocks,
                {
                  type: "text" as const,
                  text:
                    error instanceof Error && error.message.includes("timeout")
                      ? "连接模型超时，请检查网络后重试。"
                      : "抱歉，生成失败，请稍后重试。",
                },
              ],
            };
          }),
        );
      } finally {
        cancelStreamRef.current = null;
        activeRunIdRef.current = null;
        setStreaming(false);
      }
    },
    [
      streaming,
      canvasId,
      applyStreamEvent,
      updateSessionMessages,
      onImageGenerated,
      onVideoGenerated,
      onCanvasSync,
      onStreamEvent,
      readyAttachments,
      clearAttachments,
      ws,
      autoTitleSession,
      accessTokenRef,
      activeSessionIdRef,
      desktopExecutionContext,
    ],
  );

  const handleSend = useCallback(
    async (...args: Parameters<typeof sendMessage>) => {
      if (sendInFlightRef.current) return;
      sendInFlightRef.current = true;
      try {
        await sendMessage(...args);
      } finally {
        sendInFlightRef.current = false;
      }
    },
    [sendMessage],
  );

  const sendFromInput = useCallback((message: string, videoModel?: string) => {
    if (!videoModel) {
      handleSend(message);
      return;
    }
    handleSend(message, undefined, undefined, undefined, {
      mode: "manual",
      models: [videoModel],
      duration: activeVideoGenerationPreferenceRef.current.duration,
    });
  }, [handleSend]);

  const retryAssistantMessage = useCallback((assistantId: string) => {
    if (streaming || retryingAssistantId) return;
    const index = messages.findIndex((message) => message.id === assistantId);
    if (index < 0) return;
    const priorUsers = messages.slice(0, index).filter((message) => message.role === "user");
    const textOf = (message: typeof messages[number]) => message.contentBlocks
      .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    const hasImage = (message: typeof messages[number]) => message.contentBlocks.some((block) => block.type === "image");
    const previousUser = [...priorUsers].reverse().find((message) => hasImage(message) && /(?:视频|短片|动画|带货|生成|制作|4s|5s|秒|video|animate)/i.test(textOf(message)))
      ?? [...priorUsers].reverse().find(hasImage)
      ?? priorUsers.at(-1);
    if (!previousUser) return;
    const text = textOf(previousUser);
    if (!text) return;
    const isVideoRetry = /(?:视频|短片|动画|带货|生成|制作|4s|5s|秒|video|animate)/i.test(text);
    const retryImages = previousUser.contentBlocks
      .filter((block): block is Extract<ContentBlock, { type: "image" }> => block.type === "image");
    const attachments = selectRetryReferences(retryImages, isVideoRetry)
      .map((block) => ({
        assetId: block.assetId,
        url: block.url,
        mimeType: block.mimeType,
        source: block.source,
        ...(block.name ? { name: block.name } : {}),
      }));
    setRetryingAssistantId(assistantId);
    void handleSend(text, attachments.length > 0 ? attachments : undefined)
      .finally(() => setRetryingAssistantId(null));
  }, [handleSend, messages, retryingAssistantId, streaming]);

  const handleCancel = useCallback(() => {
    abortRef.current = true;
    directVideoAbortRef.current?.abort();
    const runId = activeRunIdRef.current;
    if (runId) ws.cancelRun(runId);
    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
    activeRunIdRef.current = null;
    setStreamPhase(null);
    setStreaming(false);
  }, [ws]);

  // ── Mention picker ──
  const mentionPickerItems: MessageMentionPickerItem[] = [
    ...(onRequestCanvasImages ? onRequestCanvasImages() : []),
    ...brandKitMentionItems,
    ...imageModelMentionItems,
    ...skillMentionItems,
  ];

  const handleMentionSelect = useCallback(
    (item: MessageMentionPickerItem) => {
      if (item.kind === "canvas-image") {
        addCanvasRef({
          assetId: item.assetId,
          url: item.url,
          mimeType: item.mimeType,
          name: item.name,
        });
        return;
      }

      setMessageMentions((prev) => {
        let nextMention: MessageMention;
        if (item.kind === "image-model") {
          nextMention = { mentionType: "image-model", id: item.id, label: item.label };
        } else if (item.kind === "skill") {
          nextMention = { mentionType: "skill", id: item.id, label: item.label, slug: item.slug };
        } else {
          nextMention = {
            mentionType: "brand-kit-asset",
            id: item.id,
            label: item.label,
            assetType: item.assetType,
            ...(item.textContent !== undefined
              ? { textContent: item.textContent }
              : {}),
            ...(item.fileUrl !== undefined
              ? { fileUrl: item.fileUrl }
              : {}),
          };
        }

        if (
          prev.some(
            (m) =>
              m.mentionType === nextMention.mentionType &&
              m.id === nextMention.id,
          )
        ) {
          return prev;
        }
        return [...prev, nextMention];
      });
    },
    [addCanvasRef],
  );

  const handleRemoveMention = useCallback((mention: MessageMention) => {
    setMessageMentions((prev) =>
      prev.filter(
        (item) =>
          !(item.mentionType === mention.mentionType && item.id === mention.id),
      ),
    );
  }, []);

  // ── Auto-send initial prompt ──
  useEffect(() => {
    if (
      !initialPrompt ||
      sessionsLoading ||
      !ws.connected ||
      initialPromptSent.current
    )
      return;

    let storedAttachments: ReadyAttachment[] | undefined;
    let storedImageGenerationPreference: ImageGenerationPreference | undefined;
    let storedVideoGenerationPreference: VideoGenerationPreference | undefined;
    let storedAgentModel: string | undefined;
    try {
      const raw = sessionStorage.getItem(INITIAL_ATTACHMENTS_KEY);
      if (raw) {
        storedAttachments = JSON.parse(raw) as ReadyAttachment[];
        sessionStorage.removeItem(INITIAL_ATTACHMENTS_KEY);
      }

      const preferenceRaw = sessionStorage.getItem(
        INITIAL_IMAGE_GENERATION_PREFERENCE_KEY,
      );
      if (preferenceRaw) {
        storedImageGenerationPreference = JSON.parse(
          preferenceRaw,
        ) as ImageGenerationPreference;
        sessionStorage.removeItem(INITIAL_IMAGE_GENERATION_PREFERENCE_KEY);
      }

      const videoPreferenceRaw = sessionStorage.getItem(
        INITIAL_VIDEO_GENERATION_PREFERENCE_KEY,
      );
      if (videoPreferenceRaw) {
        storedVideoGenerationPreference = JSON.parse(
          videoPreferenceRaw,
        ) as VideoGenerationPreference;
        sessionStorage.removeItem(INITIAL_VIDEO_GENERATION_PREFERENCE_KEY);
      }

      const modelRaw = sessionStorage.getItem(INITIAL_AGENT_MODEL_KEY);
      if (modelRaw) {
        storedAgentModel = modelRaw;
        sessionStorage.removeItem(INITIAL_AGENT_MODEL_KEY);
      }
    } catch {
      // Malformed JSON or unavailable storage
    }

    if (storedAgentModel) {
      agentModelRef.current = storedAgentModel;
    }

    if (!activeSessionIdRef.current) return;
    initialPromptSent.current = true;
    const timer = setTimeout(() => {
      void handleSend(
        initialPrompt,
        storedAttachments,
        storedImageGenerationPreference,
        undefined,
        storedVideoGenerationPreference,
      );
    }, 0);

    return () => clearTimeout(timer);
  }, [
    initialPrompt,
    sessionsLoading,
    ws.connected,
    handleSend,
    activeSessionIdRef,
  ]);

  // ── Reconnection: resume canvas binding + reload messages ──
  // Uses the shared applyStreamEvent to handle live events — no duplicated logic.
  useEffect(() => {
    if (!ws.connected || sessionsLoading) {
      if (!ws.connected) prevConnectedRef.current = false;
      return;
    }
    if (prevConnectedRef.current) return;
    prevConnectedRef.current = true;

    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;

    // Skip if initialPrompt effect will handle binding
    if (initialPrompt && !initialPromptSent.current) return;

    void (async () => {
      // Reload messages from DB (server may have persisted while disconnected)
      await reloadMessages(sessionId);

      // Resume canvas binding (after DB messages are set)
      ws.resumeCanvas(canvasId, (ack) => {
        const activeRunId = (ack.payload as Record<string, unknown>)
          .activeRunId;
        if (activeRunId && typeof activeRunId === "string") {
          setStreaming(true);

          const assistantId = `resumed_${activeRunId}`;
          // Must use updateSessionMessages (not setMessages) so the placeholder
          // lands in msgCacheRef as well as React state. applyStreamEvent reads
          // from the cache — if the placeholder only lives in React state, stream
          // events can't find it and the first updateSessionMessages call
          // overwrites state back to the stale cache (losing the placeholder).
          updateSessionMessages(sessionId, (prev) => {
            if (prev.some((m) => m.id === assistantId)) return prev;
            return [
              ...prev,
              {
                id: assistantId,
                role: "assistant" as const,
                contentBlocks: [],
                createdAt: nowIso(),
              },
            ];
          });

          // Reuse the shared stream event handler — eliminates ~70 lines of duplication
          const unsub = ws.onEvent((evt) => {
            if (evt.runId !== activeRunId) return;

            applyStreamEvent(evt, assistantId, sessionId);
            onStreamEvent?.(evt);

            // Fire canvas insertion callbacks for artifacts arriving after reconnect.
            // Skip if the backend already inserted the element (elementId in output).
            const wsBackendInserted = evt.type === "tool.completed"
              && evt.output
              && typeof (evt.output as Record<string, unknown>).elementId === "string";
            if (
              evt.type === "tool.completed" &&
              evt.artifacts &&
              evt.toolName !== "screenshot_canvas" &&
              !wsBackendInserted
            ) {
              for (const artifact of evt.artifacts) {
                if (artifact.type === "image" && onImageGenerated) {
                  onImageGenerated(artifact as ImageArtifact);
                }
                if (artifact.type === "video" && onVideoGenerated) {
                  onVideoGenerated(artifact as VideoArtifact);
                }
              }
            }

            if (evt.type === "canvas.sync" && onCanvasSync) {
              onCanvasSync();
            }

            if (
              evt.type === "run.completed" ||
              evt.type === "run.failed" ||
              evt.type === "run.canceled"
            ) {
              setStreaming(false);
              unsub();
            }
          });
        }
      });
    })();
  }, [
    ws.connected,
    ws,
    canvasId,
    sessionsLoading,
    applyStreamEvent,
    onStreamEvent,
    onImageGenerated,
    onVideoGenerated,
    onCanvasSync,
    activeSessionIdRef,
    reloadMessages,
    updateSessionMessages,
    setStreaming,
    initialPrompt,
  ]);

  const approvalCards = useMemo(() => uniqueGenerationApprovals(messages), [messages]);
  const canvasApprovalId = typeof canvasApproval?.approvalId === "string" ? canvasApproval.approvalId : null;
  const approvalRenderedInMessage = canvasApprovalId !== null && approvalCards.visibleIds.has(canvasApprovalId);
  const handleCanvasApprovalJobCreated = useCallback((jobId: string) => {
    if (!canvasApproval) return;
    setCanvasApproval(null);
    setCanvasApprovalJob({
      id: jobId,
      jobType: canvasApproval.jobType === "video_generation" ? "video_generation" : "image_generation",
      status: "queued",
      progress: 0,
    });
  }, [canvasApproval]);

  // ── Collapsed state ──
  if (!open) {
    return (
      <div className="absolute right-3 top-3 z-20">
        <button
          ref={collapsedTriggerRef}
          onClick={onToggle}
          type="button"
          aria-label="打开 AI 对话面板"
          aria-expanded={false}
          aria-controls="canvas-chat-panel"
          className="group inline-flex items-center gap-1 rounded-xl glass-soft border border-border/60 px-2.5 py-1.5 text-xs text-foreground/70 hover:text-foreground transition-all duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-foreground/20 md:px-2.5 md:py-1.5 min-h-[36px] md:min-h-0"
        >
          <svg className="size-4 md:size-3.5" viewBox="0 0 24 24" fill="none">
            <path
              fill="currentColor"
              fillOpacity={0.9}
              d="M18.25 3c2.071 0 3.946 2.16 3.946 4.23L22 15.75a3.75 3.75 0 0 1-3.75 3.75h-2.874a.25.25 0 0 0-.16.058l-2.098 1.738a1.75 1.75 0 0 1-2.24-.007l-2.065-1.73a.25.25 0 0 0-.162-.059H5.75A3.75 3.75 0 0 1 2 15.75v-9A3.75 3.75 0 0 1 5.75 3zM7.5 10q-.053 0-.104.005a1.25 1.25 0 0 0-1.14 1.117l-.006.128.007.128a1.25 1.25 0 1 0 1.37-1.371l-.02-.002A1 1 0 0 0 7.5 10m4.5 0q-.053 0-.104.005a1.25 1.25 0 0 0-1.14 1.117l-.006.128.007.128a1.25 1.25 0 1 0 1.37-1.371l-.02-.002A1 1 0 0 0 12 10m4.5 0q-.053 0-.105.005a1.25 1.25 0 0 0-1.138 1.117l-.007.128.007.128a1.25 1.25 0 1 0 1.37-1.371l-.02-.002A1 1 0 0 0 16.5 10"
            />
          </svg>
          对话
        </button>
      </div>
    );
  }

  // Shared event isolation — prevent keyboard/clipboard events from bleeding
  // into Excalidraw canvas when the sidebar has focus.
  const eventIsolationProps = {
    onKeyDown: (e: React.KeyboardEvent) => {
      if (isOverlay && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
        return;
      }

      if (isOverlay && e.key === "Tab") {
        const panel = chatPanelRef.current;
        if (panel) {
          const focusable = Array.from(
            panel.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          );
          const first = focusable[0];
          const last = focusable.at(-1);
          if (first && last) {
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      }

      e.stopPropagation();
    },
    onKeyUp: (e: React.KeyboardEvent) => e.stopPropagation(),
    onCopy: (e: React.ClipboardEvent) => e.stopPropagation(),
    onCut: (e: React.ClipboardEvent) => e.stopPropagation(),
    onPaste: (e: React.ClipboardEvent) => e.stopPropagation(),
    onWheel: (e: React.WheelEvent) => e.stopPropagation(),
  };

  // The inner panel content is shared across all breakpoints.
  // Extracted as a variable to avoid duplicating the chat UI tree
  // between overlay (mobile/tablet) and inline (desktop) render paths.
  const generationStopped = canvasApprovalJob
    ? ["failed", "dead_letter", "canceled"].includes(canvasApprovalJob.status)
    : false;
  const legacyGenerationTitle = canvasApprovalJob?.status === "succeeded"
    ? "图片已生成，画布已更新"
    : generationStopped
      ? "图片生成已停止"
      : canvasApprovalJob?.status === "queued"
        ? "等待启动"
        : "图片生成中";
  const generationTitle = canvasApprovalJob?.jobType === "video_generation"
    ? generationStopped
      ? "视频生成已停止"
      : canvasApprovalJob?.status === "succeeded"
        ? "视频已生成，画布已更新"
        : canvasApprovalJob?.status === "queued"
          ? "等待启动"
          : "视频生成中"
    : legacyGenerationTitle;
  const generationProgress = canvasApprovalJob?.status === "succeeded"
    ? "100%"
    : generationStopped
      ? "已停止"
      : `${canvasApprovalJob?.progress ?? 0}%`;
  const legacyGenerationDetail = canvasApprovalJob
    ? generationStopped
      ? canvasApprovalJob.error ?? "任务未完成，请重试。"
      : canvasApprovalJob.status === "succeeded"
        ? "生成结果已同步到画布。"
        : canvasApprovalJob.status === "queued"
          ? "任务已进入队列。"
          : "上游正在处理图片请求。"
    : "";
  const generationDetail = canvasApprovalJob?.jobType === "video_generation"
    ? generationStopped
      ? canvasApprovalJob.error ?? "Video generation did not complete."
      : canvasApprovalJob.status === "succeeded"
        ? "Video result synced to the canvas."
        : canvasApprovalJob.status === "queued"
          ? "Video task entered the queue."
          : "The upstream video provider is processing the request."
    : legacyGenerationDetail;
  const mediaJobRenderedInMessage = canvasApprovalJob
    ? messages.some((message) => message.contentBlocks.some((block) => {
        if (block.type !== "tool" || !["generate_image", "generate_video"].includes(block.toolName)) return false;
        const input = block.input as Record<string, unknown> | undefined;
        const output = block.output as Record<string, unknown> | undefined;
        const jobIds = [input?.jobId, input?.job_id, output?.jobId, output?.job_id].filter((value): value is string => typeof value === "string");
        return jobIds.includes(canvasApprovalJob.id);
      }))
    : false;
  const panelContent = (
    <>
      {/* Header */}
      <div className="flex min-h-[48px] items-center justify-between pl-4 pr-2">
        <div className="flex items-center gap-1 min-w-0">
          <h2 id="canvas-chat-panel-title" className="text-sm font-medium text-foreground shrink-0">
            Helstera Agent
          </h2>
          {!sessionsLoading && (
            <SessionSelector
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={handleSelectSession}
              onNewChat={handleNewChat}
              onDelete={handleDeleteSession}
            />
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          ref={chatCloseButtonRef}
          aria-label="关闭 AI 对话面板"
          className="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full p-1.5 text-muted-foreground transition-all duration-200 hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="关闭 AI 对话面板"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 3.25a.75.75 0 0 1 .75.75v16a.75.75 0 0 1-1.5 0V4A.75.75 0 0 1 4 3.25m9.47 2.22a.75.75 0 0 1 1.06 0l6 6a.75.75 0 0 1 0 1.06l-6 6a.75.75 0 1 1-1.06-1.06l4.72-4.72H8a.75.75 0 0 1 0-1.5h10.19l-4.72-4.72a.75.75 0 0 1 0-1.06"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>

      {/* Disconnected banner */}
      {!ws.connected && (
        <div className="flex items-center gap-2 px-4 py-2 bg-destructive/[0.04] border-b border-destructive/[0.08]">
          <div className="h-2 w-2 rounded-full bg-red-500 animate-[pulse_1.2s_ease-in-out_infinite]" />
          <span className="text-[11px] text-muted-foreground">
            连接已断开，正在重连...
          </span>
        </div>
      )}

      {canvasApproval && !approvalRenderedInMessage ? (
        <div className="border-b border-amber-500/20 bg-amber-500/[0.03] px-3 py-3">
          <GenerationApprovalCard
            approvalId={String(canvasApproval.approvalId)}
            jobType={canvasApproval.jobType === "image_generation" ? "image_generation" : "video_generation"}
            model={typeof canvasApproval.model === "string" ? canvasApproval.model : ""}
            estimatedCredits={typeof canvasApproval.estimatedCredits === "number" ? canvasApproval.estimatedCredits : 0}
            hasReferenceImage={canvasApproval.hasReferenceImage === true}
            expiresAt={typeof canvasApproval.expiresAt === "string" ? canvasApproval.expiresAt : new Date(0).toISOString()}
            {...(typeof canvasApproval.duration === "number" ? { duration: canvasApproval.duration } : {})}
            {...(typeof canvasApproval.resolution === "string" ? { resolution: canvasApproval.resolution } : {})}
            onJobCreated={handleCanvasApprovalJobCreated}
          />
        </div>
      ) : null}
      {/* Messages */}
      <ErrorBoundary
        onError={(err) =>
          console.error("[chat-sidebar] message area render crashed:", err)
        }
      >
        <div ref={messagesViewportRef} onScroll={handleMessagesScroll} className="relative flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-6 px-4 py-4" aria-label="聊天消息">
          {sessionsLoading || messagesLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground" />
            </div>
          ) : sessionsError ? (
            <div role="alert" className="mx-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <span>{sessionsError}</span>
              <button type="button" onClick={() => void reloadSessions()} className="min-h-8 rounded-md border border-destructive/30 px-2.5 font-medium hover:bg-destructive/5">重试加载会话</button>
            </div>
          ) : messages.length === 0 ? (
            <ChatSkills onSend={handleSend} />
          ) : (
            messages.map((msg) => {
              const sentAt = formatMessageTime(msg.createdAt);
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  <ChatMessage
                    role={msg.role}
                    contentBlocks={msg.contentBlocks}
                    isStreaming={
                      streaming &&
                      msg.role === "assistant" &&
                      msg === messages[messages.length - 1]
                    }
                    isRetrying={retryingAssistantId === msg.id}
                    onRetry={msg.role === "assistant" ? () => retryAssistantMessage(msg.id) : undefined}
                    hiddenApprovalToolCallIds={approvalCards.hiddenToolCallIds}
                    hiddenJobToolCallIds={approvalCards.hiddenJobToolCallIds}
                  />
                  {sentAt ? (
                    <time
                      dateTime={msg.createdAt}
                      title={msg.createdAt}
                      className="px-1 text-[11px] leading-none text-muted-foreground/70"
                    >
                      {sentAt}
                    </time>
                  ) : null}
                </div>
              );
            })
          )}
          {streaming && streamPhase && (
            <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/50" />
              {streamPhase === "connecting"
                ? "正在连接模型..."
                : streamPhase === "processing"
                  ? "模型正在生成，请稍候..."
                  : "模型响应较慢，仍在处理中..."}
            </div>
          )}
          {messagesError && !messagesLoading ? (
            <div role="alert" className="mx-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <span>{messagesError}</span>
              <button type="button" onClick={() => void reloadMessages(activeSessionIdRef.current ?? "")} className="min-h-8 rounded-md border border-destructive/30 px-2.5 font-medium hover:bg-destructive/5">重新加载</button>
            </div>
          ) : null}
          {canvasApprovalJob && !mediaJobRenderedInMessage ? (
            <div className="shrink-0 rounded-lg border border-border/60 bg-muted/20 px-3 py-3" role="status" aria-live="polite" aria-atomic="true" aria-label="生成任务状态">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-foreground">{generationTitle}</span>
                <span className={`shrink-0 ${generationStopped ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                  {generationProgress}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/60" aria-hidden="true">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${generationStopped ? "bg-red-500" : "bg-foreground"}`}
                  style={{ width: `${canvasApprovalJob.status === "succeeded" ? 100 : canvasApprovalJob.progress}%` }}
                />
              </div>
              <p className="mt-2 truncate text-[11px] text-muted-foreground">{generationDetail}</p>
            </div>
          ) : null}
          <div ref={messagesEndRef} />
          {showLatestButton && <button type="button" onClick={() => { shouldAutoFollowRef.current = true; setShowLatestButton(false); scrollToBottom(); }} className="sticky bottom-2 self-center rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm" aria-label="回到最新消息">回到最新消息</button>}
        </div>
      </ErrorBoundary>

      {/* Input */}
      <div className="relative">
        {atQuery !== null && mentionPickerItems.length > 0 && (
          <MessageMentionPicker
            items={mentionPickerItems}
            query={atQuery}
            onSelect={(item) => {
              handleMentionSelect(item);
              chatInputRef.current?.clearAtQuery();
              setAtQuery(null);
            }}
            onClose={() => setAtQuery(null)}
          />
        )}
        <ChatInput
          ref={chatInputRef}
          onSend={sendFromInput}
          disabled={streaming || sessionsLoading}
          attachments={imageAttachments}
          onAddFiles={addFiles}
          onRemoveAttachment={removeAttachment}
          onRetryAttachment={retryUpload}
          isUploading={isUploading}
          onCancel={handleCancel}
          onAtQuery={setAtQuery}
          mentions={messageMentions}
          onRemoveMention={handleRemoveMention}
          {...(selectedCanvasElements ? { selectedCanvasElements } : {})}
        />
      </div>
    </>
  );

  const creditDialogEl = creditDialog && (
    <CreditInsufficientDialog
      open={creditDialog.open}
      onClose={() => setCreditDialog(null)}
      currentBalance={creditDialog.currentBalance}
      requiredAmount={creditDialog.requiredAmount}
    />
  );

  const modelFailoverDialogEl = modelFailoverDialog && (
    <Dialog open={true} onOpenChange={(open) => !open && setModelFailoverDialog(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>生成失败，选择其他模型</DialogTitle>
          <DialogDescription>当前模型不可用。系统不会自动切换，请选择后重新提交本次任务。</DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {modelFailoverDialog.candidates.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">暂无其他可尝试模型，请打开模型设置。</p>}
          {modelFailoverDialog.candidates.map((candidate) => {
            const isUnverified = candidate.availability === "unverified" || candidate.healthStatus === "unknown";
            return <button key={candidate.id} type="button" className="flex w-full items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-left hover:bg-muted" onClick={() => {
              const storageKey = modelFailoverDialog.mediaType === "video" ? "helstera:video-model-preference" : "helstera:image-model-preference";
              let current: Record<string, unknown> = {};
              try { current = JSON.parse(localStorage.getItem(storageKey) ?? "{}"); } catch { /* reset malformed preference */ }
              localStorage.setItem(storageKey, JSON.stringify({ ...current, mode: "manual", models: [candidate.id] }));
              window.dispatchEvent(new CustomEvent("helstera:model-preference-changed"));
              const retryPrompt = modelFailoverDialog.prompt;
              setModelFailoverDialog(null);
              window.dispatchEvent(new CustomEvent("helstera:retry-generation", { detail: { prompt: retryPrompt, submit: true, videoModel: candidate.id } }));
            }}><span className="min-w-0 truncate text-sm font-medium">{candidate.displayName}</span><span className={`ml-3 shrink-0 text-[10px] ${isUnverified ? "text-amber-600" : "text-emerald-600"}`}>{isUnverified ? "未验证，仅手动尝试" : "已验证"}</span></button>;
          })}
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setModelFailoverDialog(null)}>取消</Button><Button type="button" onClick={() => { const mediaType = modelFailoverDialog.mediaType; setModelFailoverDialog(null); window.dispatchEvent(new CustomEvent("helstera:open-model-preference", { detail: { mediaType } })); }}>打开模型设置</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const modelSelectionDialogEl = (
    <Dialog
      open={modelSelectionDialog !== null}
      onOpenChange={(open) => !open && setModelSelectionDialog(null)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>已锁定用户选择的模型</DialogTitle>
          <DialogDescription>
            {modelSelectionDialog ?? "本次请求不会自动切换模型。请更换用户选择的模型，或改为自动路由后重试。"}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={() => setModelSelectionDialog(null)}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ── Mobile / Tablet: full-screen overlay with backdrop ──
  if (isOverlay) {
    return (
      <>
        {/* Semi-transparent backdrop — click to close */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop is a non-interactive dismissal layer, keyboard close is handled via Escape */}
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-200"
          onClick={onToggle}
        />
        {/* Chat panel — full screen on mobile, fixed-width drawer on tablet */}
        <div
          ref={chatPanelRef}
          id="canvas-chat-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="canvas-chat-panel-title"
          className={
            breakpoint === "mobile"
              ? "fixed inset-0 z-50 flex flex-col glass-strong animate-in slide-in-from-right duration-250"
              : "fixed inset-y-0 right-0 z-50 flex w-[400px] flex-col border-l border-border/40 glass shadow-card-hover animate-in slide-in-from-right duration-250"
          }
          {...eventIsolationProps}
        >
          {panelContent}
        </div>
        {creditDialogEl}
        {modelSelectionDialogEl}
        {modelFailoverDialogEl}
      </>
    );
  }

  // ── Desktop: inline side-by-side with resize handle ──
  return (
    <div
      className="flex h-full shrink-0"
      style={{ width: sidebarWidth }}
      {...eventIsolationProps}
    >
      {/* Resize handle -- supports mouse, touch, and keyboard (ArrowLeft/ArrowRight) */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整对话面板宽度"
        aria-valuenow={sidebarWidth}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        tabIndex={0}
        className="w-2 shrink-0 cursor-col-resize bg-gradient-to-r from-transparent via-border to-transparent shadow-[1px_0_10px_rgba(15,23,42,0.06)] transition-all hover:via-muted-foreground/40 hover:shadow-[1px_0_14px_rgba(15,23,42,0.1)] active:via-muted-foreground/60 active:shadow-[1px_0_16px_rgba(15,23,42,0.14)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onKeyDown={handleResizeKeyDown}
      />
      <div className="flex flex-1 flex-col min-w-0">
        {panelContent}
      </div>
      {creditDialogEl}
      {modelSelectionDialogEl}
        {modelFailoverDialogEl}
    </div>
  );
}
