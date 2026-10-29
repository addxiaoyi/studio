"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

type CanvasEmptyHintProps = {
  excalidrawApi: any;
  ready: boolean;
  desktopMode?: boolean;
  onOpenChat: () => void;
};

/**
 * Floating overlay hint shown when the Excalidraw canvas has no visible
 * elements. Pressing the `C` key opens the chat sidebar and focuses the
 * chat input textarea.
 */
export function CanvasEmptyHint({
  excalidrawApi,
  ready,
  desktopMode = false,
  onOpenChat,
}: CanvasEmptyHintProps) {
  const [hasElements, setHasElements] = useState(false);
  const onOpenChatRef = useRef(onOpenChat);
  onOpenChatRef.current = onOpenChat;

  // Poll the Excalidraw API every 500ms to determine if the canvas contains
  // any non-deleted elements.
  useEffect(() => {
    function check() {
      if (!ready || !excalidrawApi) {
        setHasElements(false);
        return;
      }
      const elements: any[] = excalidrawApi.getSceneElements?.() ?? [];
      setHasElements(elements.some((el: any) => !el.isDeleted));
    }

    check();
    const id = setInterval(check, 500);
    return () => clearInterval(id);
  }, [excalidrawApi, ready]);

  // Global keydown listener for the `C` shortcut.
  useEffect(() => {
    if (!ready || hasElements) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when the user is typing in an input or textarea.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // Also ignore if contentEditable
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        onOpenChatRef.current();

        // The textarea may not be in the DOM yet (sidebar was closed), so
        // retry focus with a short delay.
        requestAnimationFrame(() => {
          const textarea = document.querySelector<HTMLTextAreaElement>(
            "textarea[data-chat-input]",
          );
          if (textarea) {
            textarea.focus();
          } else {
            // Sidebar might animate open; retry once more.
            setTimeout(() => {
              document
                .querySelector<HTMLTextAreaElement>(
                  "textarea[data-chat-input]",
                )
                ?.focus();
            }, 100);
          }
        });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasElements, ready]);

  if (!ready || !excalidrawApi || hasElements) return null;

  if (desktopMode) {
    return (
      <div className="desktop-canvas-empty-layer pointer-events-none absolute inset-0 z-20 grid place-items-center">
        <div className="desktop-canvas-empty-hint text-center">
          <p className="desktop-canvas-empty-hint__eyebrow">空白画布</p>
          <h2>从一句话开始创作</h2>
          <p>描述你的目标，Agent 会在这张画布上协助完成。</p>
          <button
            type="button"
            onClick={() => onOpenChatRef.current()}
            className="desktop-canvas-empty-hint__action pointer-events-auto"
          >
            <Sparkles aria-hidden="true" />
            打开 AI 创作
            <ArrowRight aria-hidden="true" />
          </button>
          <p className="desktop-canvas-empty-hint__shortcut"><kbd>C</kbd><span>快速打开对话</span></p>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/40 bg-background/75 px-6 py-5 text-center shadow-soft backdrop-blur-sm">
        <p className="text-sm text-muted-foreground">输入你的想法开始创作</p>
        <button
          type="button"
          onClick={() => onOpenChatRef.current()}
          className="pointer-events-auto min-h-10 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          打开 AI 创作
        </button>
        <span className="text-[11px] text-muted-foreground/80">也可以按 C 快速打开</span>
      </div>
    </div>
  );
}
