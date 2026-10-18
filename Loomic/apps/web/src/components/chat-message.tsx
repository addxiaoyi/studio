"use client";

import { motion } from "framer-motion";
import React, { useMemo } from "react";

import type { ContentBlock, ToolArtifact, ToolBlock } from "@helstera/shared";
import { ImagePill } from "./chat/image-lightbox";
import { MarkdownRenderer } from "./chat/markdown-renderer";
import { MentionPill } from "./chat/mention-pill";
import { collapseDuplicateImageReferences } from "./chat/utils";
import LatticeLoader from "./ui/LatticeLoader";
import { ToolBlockView } from "./chat/tool-block-view";
import { ThinkingBlockView } from "./chat/thinking-block-view";

// Re-export types for backward compatibility with existing consumers
export type { ContentBlock, ToolArtifact };

function sanitizeAssistantText(text: string): string {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").replace(/<\/?think>/gi, "");
}

/** @deprecated Use ToolBlock from @helstera/shared instead */
export type ToolActivity = ToolBlock;

/* ------------------------------------------------------------------ */
/*  ChatMessage                                                        */
/* ------------------------------------------------------------------ */

type ChatMessageProps = {
  role: "user" | "assistant";
  contentBlocks: ContentBlock[];
  hiddenApprovalToolCallIds?: ReadonlySet<string> | undefined;
  hiddenJobToolCallIds?: ReadonlySet<string> | undefined;
  isStreaming?: boolean;
  isRetrying?: boolean;
  onRetry?: (() => void) | undefined;
};

/**
 * Top-level chat message component.
 *
 * Memoized with a custom comparator: skips re-render when contentBlocks
 * reference and isStreaming flag are unchanged. During streaming, only the
 * actively-streaming message receives new contentBlocks arrays; all prior
 * messages keep the same reference and skip rendering entirely.
 *
 * Sub-components (MarkdownRenderer, ToolBlockView, ThinkingBlockView) are
 * each independently memoized for fine-grained update control.
 */
export const ChatMessage = React.memo(
  function ChatMessage({
    role,
    contentBlocks,
    hiddenApprovalToolCallIds,
    hiddenJobToolCallIds,
    isStreaming,
    isRetrying,
    onRetry,
  }: ChatMessageProps) {
    const isUser = role === "user";

    if (isUser) {
      return <UserMessage contentBlocks={contentBlocks} />;
    }

    return (
      <AssistantMessage
        contentBlocks={contentBlocks}
        hiddenApprovalToolCallIds={hiddenApprovalToolCallIds}
        hiddenJobToolCallIds={hiddenJobToolCallIds}
        isStreaming={isStreaming ?? false}
        isRetrying={isRetrying ?? false}
        onRetry={onRetry}
      />
    );
  },
  (prev, next) => {
    // Custom comparator: referential equality on contentBlocks is sufficient
    // because updateSessionMessages always creates a new array when content changes
    return (
      prev.role === next.role &&
      prev.contentBlocks === next.contentBlocks &&
      prev.hiddenApprovalToolCallIds === next.hiddenApprovalToolCallIds &&
      prev.hiddenJobToolCallIds === next.hiddenJobToolCallIds &&
      prev.isStreaming === next.isStreaming &&
      prev.isRetrying === next.isRetrying &&
      prev.onRetry === next.onRetry
    );
  },
);

/* ------------------------------------------------------------------ */
/*  UserMessage                                                        */
/* ------------------------------------------------------------------ */

const UserMessage = React.memo(function UserMessage({
  contentBlocks,
}: {
  contentBlocks: ContentBlock[];
}) {
  // Categorize blocks once per render
  const { text, imageBlocks, mentionBlocks } = useMemo(() => {
    const textParts: string[] = [];
    const images: Extract<ContentBlock, { type: "image" }>[] = [];
    const mentions: ContentBlock[] = [];

    for (const block of contentBlocks) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "image") {
        images.push(block);
      } else if (block.type === "mention") {
        mentions.push(block);
      }
    }

    return {
      text: textParts.join(""),
      imageBlocks: images,
      mentionBlocks: mentions,
    };
  }, [contentBlocks]);
  const { images: uniqueImages, duplicateCount: duplicateImageCount } = useMemo(
    () => collapseDuplicateImageReferences(imageBlocks),
    [imageBlocks],
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex w-full flex-col items-end gap-2 pl-10"
    >
      {text && (
        <div className="inline-block rounded-xl bg-muted px-3 py-2.5 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-foreground">
          <span className="cursor-text select-text [word-break:break-word]">
            {text}
          </span>
          {mentionBlocks.length > 0 && (
            <span className="inline">
              {mentionBlocks.map((block, idx) => (
                <MentionPill
                  key={idx}
                  label={(block as { label: string }).label}
                  kind={
                    (
                      block as {
                        mentionType: "image-model" | "brand-kit-asset";
                      }
                    ).mentionType
                  }
                />
              ))}
            </span>
          )}
          {uniqueImages.length > 0 && (
            <span className="inline">
              {uniqueImages.map((block, idx) => (
                <ImagePill
                  key={idx}
                  src={block.url}
                  name={block.name ?? `image-${idx + 1}`}
                />
              ))}
              {duplicateImageCount > 0 && (
                <span className="ml-2 text-[11px] text-muted-foreground" aria-label={`已折叠 ${duplicateImageCount} 张重复参考图`}>
                  +{duplicateImageCount} 张重复引用已折叠
                </span>
              )}
            </span>
          )}
        </div>
      )}
      {!text && (uniqueImages.length > 0 || mentionBlocks.length > 0) && (
        <div className="inline-block rounded-xl bg-muted px-3 py-2.5">
          {mentionBlocks.map((block, idx) => (
            <MentionPill
              key={`mention-${idx}`}
              label={(block as { label: string }).label}
              kind={
                (
                  block as {
                    mentionType: "image-model" | "brand-kit-asset";
                  }
                ).mentionType
              }
            />
          ))}
          {uniqueImages.map((block, idx) => (
            <ImagePill
              key={idx}
              src={block.url}
              name={block.name ?? `image-${idx + 1}`}
            />
          ))}
          {duplicateImageCount > 0 && (
            <span className="ml-2 text-[11px] text-muted-foreground" aria-label={`已折叠 ${duplicateImageCount} 张重复参考图`}>
              +{duplicateImageCount} 张重复引用已折叠
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
});

/* ------------------------------------------------------------------ */
/*  AssistantMessage                                                    */
/* ------------------------------------------------------------------ */

const AssistantMessage = React.memo(function AssistantMessage({
  contentBlocks,
  hiddenApprovalToolCallIds,
  hiddenJobToolCallIds,
  isStreaming,
  isRetrying,
  onRetry,
}: {
  contentBlocks: ContentBlock[];
  hiddenApprovalToolCallIds?: ReadonlySet<string> | undefined;
  hiddenJobToolCallIds?: ReadonlySet<string> | undefined;
  isStreaming: boolean;
  isRetrying: boolean;
  onRetry?: (() => void) | undefined;
}) {
  // Find the last text block index for streaming cursor placement
  const lastTextIdx = useMemo(() => {
    for (let i = contentBlocks.length - 1; i >= 0; i--) {
      if (contentBlocks[i]!.type === "text") return i;
    }
    return -1;
  }, [contentBlocks]);

  // Show thinking indicator when streaming but no content has arrived yet
  const hasContent = useMemo(
    () =>
      contentBlocks.some(
        (b) =>
          (b.type === "text" && b.text.length > 0) ||
          b.type === "tool",
      ),
    [contentBlocks],
  );

  const showThinking = isStreaming && !hasContent;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex w-full flex-col gap-2 pr-10"
    >
      {showThinking && (
        <LatticeLoader
          label="思考中"
          doneLabel="已完成"
          errorLabel="未完成"
          className="text-muted-foreground"
          pattern="orbit"
          fontSize={14}
        />
      )}
      {contentBlocks.map((block, idx) => {
        if (block.type === "thinking") {
          return (
            <ThinkingBlockView
              key={idx}
              thinking={block.thinking}
              isStreaming={isStreaming}
            />
          );
        }

        if (block.type === "text") {
          const showCursor = isStreaming && idx === lastTextIdx;
          return (
            <MarkdownRenderer
              key={idx}
              text={sanitizeAssistantText(block.text)}
              showCursor={showCursor}
            />
          );
        }

        if (block.type === "tool") {
          return (
            <ToolBlockView
              key={block.toolCallId}
              block={block}
              hideApprovalCard={hiddenApprovalToolCallIds?.has(block.toolCallId)}
              hideDuplicateJob={hiddenJobToolCallIds?.has(block.toolCallId)}
            />
          );
        }

        // ImageBlock -- skip in assistant messages (user-side only)
        return null;
      })}
      {onRetry && !isStreaming && contentBlocks.length > 0 && (
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          aria-busy={isRetrying}
          className="self-start rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60"
          aria-label="重试上一条请求"
        >
          {isRetrying ? "重试中..." : "重试"}
        </button>
      )}
    </motion.div>
  );
});
