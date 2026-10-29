"use client";

import {
  forwardRef,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Square } from "lucide-react";

import type { MessageMention } from "@helstera/shared";
import type { ImageAttachmentState } from "../hooks/use-image-attachments";
import type { CanvasSelectedElement } from "./canvas-editor";
import { useImageModelPreference } from "../hooks/use-image-model-preference";
import { useVideoModelPreference } from "../hooks/use-video-model-preference";
import { AgentModelSelector } from "./agent-model-selector";
import { ImageAttachmentBar } from "./image-attachment-bar";
import { ImageModelPreferencePopover } from "./image-model-preference";

/** #27 输入框字数上限，集中定义，textarea 的 maxLength 与剩余字数提示共用同一常量 */
export const MAX_INPUT_LENGTH = 8000;

/** #27 已用字数达到上限的这个比例时开始提示「剩余 N 字」（9000 => 8000 的 90%） */
export const REMAINING_LENGTH_PROMPT_RATIO = 0.9;

/** 提交前的草稿快照：失败回填时用它在原位恢复文本、选区与焦点（#8） */
type DraftSnapshot = { text: string; selectionStart: number; selectionEnd: number };

/**
 * 从输入文本推导 @ 提及查询词。
 * 与旧 handleChange 内联逻辑等价，抽成纯函数以便把派生计算移出按键同步路径（#4）。
 */
export function deriveMentionQuery(text: string): string | null {
  const lastAtIdx = text.lastIndexOf("@");
  if (lastAtIdx === -1) return null;

  const charBefore = lastAtIdx > 0 ? text[lastAtIdx - 1] : " ";
  if (charBefore !== " " && charBefore !== "\n" && lastAtIdx !== 0) return null;

  const query = text.slice(lastAtIdx + 1);
  if (query.includes(" ") || query.includes("\n")) return null;

  return query;
}

type ChatInputProps = {
  /** 返回值/抛错用于判断发送是否成功：#8 成功才清空，失败回填草稿并重新聚焦 */
  onSend: (message: string, videoModel?: string) => void | Promise<unknown>;
  disabled?: boolean;
  attachments?: ImageAttachmentState[];
  onAddFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onRetryAttachment?: (id: string) => void;
  isUploading?: boolean;
  onAtQuery?: (query: string | null) => void;
  mentions?: MessageMention[];
  onRemoveMention?: (mention: MessageMention) => void;
  selectedCanvasElements?: CanvasSelectedElement[];
  onCancel?: () => void;
};

export type ChatInputHandle = {
  /** Remove the @query text from input after picker selection */
  clearAtQuery: () => void;
};

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({
  onSend,
  disabled,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  onRetryAttachment,
  isUploading,
  onAtQuery,
  mentions,
  onRemoveMention,
  selectedCanvasElements,
  onCancel,
}, ref) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [dropMessage, setDropMessage] = useState<string | null>(null);
  const { preference } = useImageModelPreference();
  const { preference: videoPreference } = useVideoModelPreference();
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const pendingSendRef = useRef<{
    text: string;
    attachmentIds: string[];
  } | null>(null);
  // 最新值的镜像：异步发送成功时只在草稿没被改写的情况下清空，避免抹掉等待期间的新输入
  const valueRef = useRef(value);
  valueRef.current = value;
  // 失败回填时待恢复的选区：等文本落到 DOM（value 更新）后再聚焦，避免光标定位到旧内容上
  const restoreCaretRef = useRef<DraftSnapshot | null>(null);

  const focusDraft = useCallback((snapshot: DraftSnapshot) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    const end = snapshot.text.length;
    try {
      textarea.setSelectionRange(
        Math.min(snapshot.selectionStart, end),
        Math.min(snapshot.selectionEnd, end),
      );
    } catch {
      // 不支持选区恢复的环境里，聚焦已经足够让用户可以继续编辑
    }
  }, []);

  /** #8 失败回填：恢复文本与光标位置，并让输入框重新获得焦点 */
  const restoreDraft = useCallback(
    (snapshot: DraftSnapshot) => {
      if (valueRef.current === snapshot.text) {
        // 文本从未被清空（异步失败路径），只需把焦点与光标还回去
        focusDraft(snapshot);
        return;
      }
      restoreCaretRef.current = snapshot;
      setValue(snapshot.text);
    },
    [focusDraft],
  );

  useEffect(() => {
    const pending = restoreCaretRef.current;
    if (!pending || pending.text !== value) return;
    restoreCaretRef.current = null;
    focusDraft(pending);
  }, [value, focusDraft]);

  /**
   * #8 提交前先快照草稿，再按 onSend 的结果决定去留：
   * - 同步抛错 / 返回的 Promise 被 reject：回填草稿、恢复光标、重新聚焦
   * - 返回 Promise：只有 resolve（成功）才清空
   * - 返回 void：没有失败信号，保持旧行为（立即清空）
   */
  const dispatchSend = useCallback(
    (text: string) => {
      const textarea = textareaRef.current;
      const snapshot: DraftSnapshot = {
        text: value,
        selectionStart: textarea?.selectionStart ?? value.length,
        selectionEnd: textarea?.selectionEnd ?? value.length,
      };
      const clearDraft = () => {
        // 等待期间用户改过草稿时不清空，否则会抹掉新输入
        if (valueRef.current !== snapshot.text) return;
        setValue("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      };

      let result: void | Promise<unknown>;
      try {
        result = onSend(text);
      } catch {
        restoreDraft(snapshot);
        return;
      }
      if (result && typeof (result as Promise<unknown>).then === "function") {
        void (result as Promise<unknown>).then(clearDraft, () => restoreDraft(snapshot));
        return;
      }
      clearDraft();
    },
    [value, onSend, restoreDraft],
  );

  useImperativeHandle(ref, () => ({
    clearAtQuery() {
      setValue((prev) => {
        const lastAtIdx = prev.lastIndexOf("@");
        if (lastAtIdx === -1) return prev;
        return prev.slice(0, lastAtIdx);
      });
    },
  }));

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && (!attachments || attachments.length === 0)) || disabled) return;
    if (isUploading) {
      pendingSendRef.current = {
        text: trimmed,
        attachmentIds: (attachments ?? []).map((attachment) => attachment.id),
      };
      return;
    }
    if (attachments?.some((attachment) => attachment.error)) return;
    if (trimmed === "/提示词" || trimmed === "/prompts") {
      sessionStorage.setItem("helstera_prompt_return", window.location.href);
      router.push("/prompts?pick=1");
      return;
    }
    dispatchSend(trimmed);
  }, [value, disabled, isUploading, attachments, router, dispatchSend]);

  useEffect(() => {
    const pending = pendingSendRef.current;
    if (isUploading || !pending || disabled) return;

    const currentAttachments = attachments ?? [];
    const currentIds = new Set(currentAttachments.map((attachment) => attachment.id));
    const pendingAttachmentsStillPresent = pending.attachmentIds.every((id) => currentIds.has(id));
    if (!pendingAttachmentsStillPresent) {
      pendingSendRef.current = null;
      return;
    }
    if (
      pending.attachmentIds.some((id) =>
        currentAttachments.some((attachment) => attachment.id === id && attachment.error),
      )
    ) {
      return;
    }

    pendingSendRef.current = null;
    dispatchSend(pending.text);
  }, [attachments, disabled, isUploading, dispatchSend]);

  useEffect(() => {
    const selected = sessionStorage.getItem("helstera_selected_prompt");
    if (!selected) return;
    sessionStorage.removeItem("helstera_selected_prompt");
    setValue(selected);
  }, []);

  // #80: the desktop global shortcut (Ctrl+Shift+Space) hands focus to this composer.
  useEffect(() => {
    const desktop = (window as Window & {
      electronAPI?: { onFocusAgentInput?: (callback: () => void) => () => void };
    }).electronAPI;
    if (!desktop?.onFocusAgentInput) return;
    return desktop.onFocusAgentInput(() => {
      requestAnimationFrame(() => textareaRef.current?.focus());
    });
  }, []);

  useEffect(() => {
    const openModels = () => setModelPopoverOpen(true);
    const retryGeneration = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string; submit?: boolean; videoModel?: string }>).detail;
      const prompt = detail?.prompt?.trim();
      if (!prompt) return;
      if (detail.submit && !disabled && !isUploading) {
        onSend(prompt, detail.videoModel);
        return;
      }
      setValue(prompt);
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener("helstera:open-model-preference", openModels);
    window.addEventListener("helstera:retry-generation", retryGeneration);
    return () => {
      window.removeEventListener("helstera:open-model-preference", openModels);
      window.removeEventListener("helstera:retry-generation", retryGeneration);
    };
  }, [disabled, isUploading, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ignore Enter during IME composition (e.g. Chinese input confirming a candidate)
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // Auto-resize textarea when value changes
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxH = 240; // max-h-60
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxH)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxH ? "auto" : "hidden";
  }, [value]);

  // #4 按键路径只做一次 setValue：@ 查询的派生与向父级通知放进延迟值 + effect，
  // 这样粘贴长文本时受控更新本身不等价于「每次全量重算 + 全量重渲染」。
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
  }, []);

  const deferredValue = useDeferredValue(value);
  const mentionQuery = useMemo(
    () => (onAtQuery ? deriveMentionQuery(deferredValue) : null),
    [deferredValue, onAtQuery],
  );
  // 只在查询词真正变化时通知父级：避免每次按键都把父级聊天树拉进同一个提交
  const notifiedMentionQueryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onAtQuery) return;
    if (notifiedMentionQueryRef.current === mentionQuery) return;
    notifiedMentionQueryRef.current = mentionQuery;
    onAtQuery(mentionQuery);
  }, [mentionQuery, onAtQuery]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0 && onAddFiles) {
        onAddFiles(Array.from(files));
      }
      e.target.value = "";
    },
    [onAddFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
      if (!onAddFiles) return;
      const droppedFiles = Array.from(e.dataTransfer.files);
      const files = droppedFiles.filter((f) => f.type.startsWith("image/"));
      setDropMessage(
        droppedFiles.length > files.length
          ? "目前只支持 PNG、JPG、WEBP 和 GIF 图片"
          : null,
      );
      if (files.length > 0) {
        onAddFiles(files);
      }
    },
    [onAddFiles],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
    setDropMessage(null);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!onAddFiles) return;
      const files = Array.from(e.clipboardData.items)
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length > 0) {
        e.preventDefault();
        onAddFiles(files);
      }
    },
    [onAddFiles],
  );

  const hasContent = value.trim().length > 0 || (attachments && attachments.length > 0);
  const hasFailedAttachment = Boolean(attachments?.some((attachment) => attachment.error));

  // #27 字数上限与剩余量：maxLength 用原生行为（超限依然能粘贴/输入到上限，不做额外 slice 造成跳变）
  const remainingLength = MAX_INPUT_LENGTH - value.length;
  const showRemainingLength = value.length >= MAX_INPUT_LENGTH * REMAINING_LENGTH_PROMPT_RATIO;

  // #26 禁用要有原因：按真实状态区分，供按钮 title 与 aria-describedby 引用同一句可见原因
  const disabledReasonId = useId();
  const isStopMode = Boolean(disabled && onCancel);
  const sendDisabled =
    Boolean(isUploading) || (Boolean(disabled) && !isStopMode) || (!disabled && !hasContent) || hasFailedAttachment;
  const disabledReason = isUploading
    ? "正在上传附件，请稍候"
    : hasFailedAttachment
      ? "请先重试或移除上传失败的附件"
      : isStopMode
        ? "生成中，可先停止"
        : disabled
          ? "生成中，请稍候"
          : !hasContent
            ? "请输入内容"
            : null;

  // Memoize canvas selection summary -- selectedCanvasElements changes on every
  // canvas interaction, but the counts only change when the selection actually differs
  const selectionSummary = useMemo(() => {
    const imageCount = selectedCanvasElements?.filter((el) => el.type === "image").length ?? 0;
    const totalCount = selectedCanvasElements?.length ?? 0;
    return {
      selectionImageCount: imageCount,
      selectionShapeCount: totalCount - imageCount,
      hasSelection: totalCount > 0,
    };
  }, [selectedCanvasElements]);
  const { selectionImageCount, selectionShapeCount, hasSelection } = selectionSummary;

  return (
    <div className="px-2 pb-2">
      <div
        className={`relative flex min-h-[120px] flex-col justify-between gap-2 rounded-2xl border glass-soft p-2 transition-[border,box-shadow,background-color] duration-200 focus-within:border-foreground/20 focus-within:shadow-card ${isDraggingFiles ? "border-primary bg-primary/[0.06] shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]" : "border-border/60"}`}
        onDrop={handleDrop}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
      >
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-xl border border-dashed border-primary bg-background/90 text-sm font-medium text-primary backdrop-blur-sm">
            松开鼠标上传图片
          </div>
        )}
        {hasSelection && (
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground glass-soft rounded-lg">
            <div className="flex items-center gap-1.5 min-w-0">
              {selectionImageCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                  {selectionImageCount} 张图片
                </span>
              )}
              {selectionImageCount > 0 && selectionShapeCount > 0 && (
                <span className="text-muted-foreground/40">&middot;</span>
              )}
              {selectionShapeCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                  </svg>
                  {selectionShapeCount} 个图形
                </span>
              )}
              <span className="text-[10px] text-muted-foreground/60">已选画布内容</span>
            </div>
          </div>
        )}
        {attachments && onRemoveAttachment && (
          <ImageAttachmentBar
            attachments={attachments}
            onRemove={onRemoveAttachment}
            {...(onRetryAttachment ? { onRetry: onRetryAttachment } : {})}
          />
        )}
        {mentions && mentions.length > 0 && onRemoveMention && (
          <div className="flex flex-wrap items-center gap-1 px-2 py-1">
            {mentions.map((mention) => (
              <button
                key={`${mention.mentionType}:${mention.id}`}
                type="button"
                onClick={() => onRemoveMention(mention)}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-[11px] text-foreground transition-all duration-300 hover:bg-foreground/[0.04]/80"
                title="Remove mention"
              >
                <span className="text-muted-foreground">@</span>
                <span className="max-w-[180px] truncate">
                  {mention.label}
                </span>
                <svg
                  className="h-3 w-3 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          data-chat-input
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          maxLength={MAX_INPUT_LENGTH}
          placeholder='输入需求，或使用 @ 引用模型、素材和技能'
          aria-label="输入消息"
          rows={1}
          style={{ scrollbarWidth: "none" }}
          className="min-h-[48px] max-h-60 resize-none bg-transparent px-1 text-sm leading-[1.8] text-foreground placeholder:text-muted-foreground focus:outline-none [&::-webkit-scrollbar]:hidden"
        />
        {dropMessage && (
          <p className="px-1 text-xs text-destructive" role="status">
            {dropMessage}
          </p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {onAddFiles && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-border text-muted-foreground transition-all duration-300 hover:bg-foreground/[0.04] hover:text-foreground"
                  title="Attach images"
                >
                  <svg
                    className="h-[14px] w-[14px]"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M16 1.1A4.9 4.9 0 0 1 20.9 6a4.9 4.9 0 0 1-1.429 3.457h.001l-8.414 8.587-.007.006a2.9 2.9 0 0 1-3.887.193l-.213-.192a2.9 2.9 0 0 1-.007-4.095l8.414-8.586a.9.9 0 0 1 1.286 1.26L8.23 15.216l-.007.006a1.1 1.1 0 0 0 1.556 1.555l8.407-8.579.007-.007a3.1 3.1 0 0 0 .105-4.271l-.105-.112a3.1 3.1 0 0 0-4.384 0L5.4 12.387l-.007.006a5.1 5.1 0 0 0 7.214 7.213l7.749-7.934a.9.9 0 0 1 1.288 1.256l-7.753 7.938q-.005.007-.012.014a6.9 6.9 0 0 1-9.758-9.76l8.408-8.578.007-.007A4.9 4.9 0 0 1 16 1.1" />
                  </svg>
                </button>
              </>
            )}
            {/* Agent model selector */}
            <AgentModelSelector compact />
            {/* Model preference button */}
            <div className="relative">
              <button
                ref={modelBtnRef}
                type="button"
                onClick={() => setModelPopoverOpen((prev) => !prev)}
                title="Image model"
                className={`flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] transition-all duration-300 ${
                  preference.mode === "manual" || videoPreference.mode === "manual"
                    ? "border-accent bg-accent/20 text-accent-foreground"
                    : "border-border text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                }`}
              >
                <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10.8 1.307a2.33 2.33 0 0 1 2.4 0l7.67 4.602A2.33 2.33 0 0 1 22 7.907v8.361a2.33 2.33 0 0 1-1.13 1.998l-7.67 4.602-.141.078a2.33 2.33 0 0 1-2.258-.078l-7.67-4.602A2.33 2.33 0 0 1 2 16.268V7.907a2.33 2.33 0 0 1 1.003-1.915l.128-.083z" />
                </svg>
              </button>
              <ImageModelPreferencePopover
                open={modelPopoverOpen}
                onClose={() => setModelPopoverOpen(false)}
                anchorRef={modelBtnRef}
              />
            </div>
          </div>
          {(showRemainingLength || disabledReason) && (
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2 px-1">
              {showRemainingLength && (
                <span
                  data-remaining-length={remainingLength}
                  className={`text-[11px] tabular-nums ${
                    remainingLength <= 0 ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  剩余 {remainingLength} 字
                </span>
              )}
              {disabledReason && (
                <p id={disabledReasonId} className="truncate text-[11px] text-muted-foreground" role="status">
                  {disabledReason}
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={isStopMode ? onCancel : handleSubmit}
            disabled={sendDisabled}
            aria-label={isStopMode ? "停止生成" : "发送消息"}
            title={disabledReason ?? (isStopMode ? "停止生成" : "发送消息")}
            {...(disabledReason ? { "aria-describedby": disabledReasonId } : {})}
            className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all duration-300 hover:bg-primary/80 active:bg-primary/90 disabled:opacity-20 disabled:cursor-not-allowed"
          >
            {isStopMode ? <Square className="size-3.5 fill-current" /> : <svg className="h-[14px] w-[14px]" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><path d="M7 11.5V2.5" /><path d="M3 6.5L7 2.5L11 6.5" /></svg>}
          </button>
        </div>
      </div>
    </div>
  );
});
