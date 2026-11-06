"use client";

import { Copy, MessageSquarePlus, Check } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useLocale } from "@/lib/i18n";
import { copyChatText } from "./message-copy";

type Passage = { text: string; left: number; top: number; origin: HTMLElement };
const MENU_WIDTH = 224;
const MENU_HEIGHT = 44;
const EDGE = 8;

function textContainer(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest<HTMLElement>("[data-chat-text]") ?? null;
}

function selectedPassage(root: HTMLElement | null): Passage | null {
  const selected = window.getSelection();
  if (!root || !selected || selected.isCollapsed || !selected.rangeCount) return null;
  const range = selected.getRangeAt(0);
  const start = textContainer(range.startContainer);
  const end = textContainer(range.endContainer);
  if (!start || start !== end || !root.contains(start)) return null;
  const text = selected.toString();
  if (!text.trim()) return null;
  const box = range.getBoundingClientRect();
  if (!box.width || !box.height || box.bottom < 0 || box.top > window.innerHeight) return null;
  const width = Math.min(MENU_WIDTH, window.innerWidth - EDGE * 2);
  return { text, origin: start.closest<HTMLElement>("[data-chat-message]") ?? start,
    left: Math.max(EDGE, Math.min((box.left + box.right - width) / 2, window.innerWidth - width - EDGE)),
    top: Math.max(EDGE, Math.min(box.top >= MENU_HEIGHT + EDGE * 2 ? box.top - MENU_HEIGHT - EDGE : box.bottom + EDGE, window.innerHeight - MENU_HEIGHT - EDGE)) };
}

function useSelectedPassage(rootRef: RefObject<HTMLElement | null>, menuRef: RefObject<HTMLDivElement | null>) {
  const [passage, setPassage] = useState<Passage | null>(null);
  const current = useRef(passage);
  current.current = passage;
  useEffect(() => {
    let selecting = false;
    const refresh = () => {
      if (selecting || menuRef.current?.contains(document.activeElement)) return;
      setPassage(selectedPassage(rootRef.current));
    };
    const pointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || menuRef.current?.contains(event.target)) return;
      selecting = Boolean(rootRef.current?.contains(event.target));
      setPassage(null);
    };
    const pointerUp = () => { if (!selecting) return;selecting = false;refresh(); };
    const dismiss = () => setPassage(null);
    const keyDown = (event: KeyboardEvent) => {
      if (!current.current) return;
      if (event.key === "Escape") {
        event.preventDefault();event.stopPropagation();
        window.getSelection()?.removeAllRanges();current.current.origin.focus({ preventScroll: true });dismiss();
      } else if (event.key === "Tab" && !event.shiftKey && !menuRef.current?.contains(document.activeElement)) {
        event.preventDefault();event.stopPropagation();menuRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("selectionchange", refresh);
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", pointerUp);
    document.addEventListener("keydown", keyDown, true);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("selectionchange", refresh);
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", pointerUp);
      document.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [rootRef, menuRef]);
  return { passage, clear: () => setPassage(null) };
}

export function ChatSelectionActions({ rootRef, onQuote }: { rootRef: RefObject<HTMLElement | null>; onQuote: (text: string) => boolean }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { passage, clear } = useSelectedPassage(rootRef, menuRef);
  const english = useLocale() === "en-US";
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null);setCopied(null); }, [passage?.text]);
  if (!passage) return null;
  async function copySelection() {
    if (!passage) return;
    try { await copyChatText(passage.text);setCopied(passage.text);setError(null); }
    catch { setError(english ? "Copy failed. Press Ctrl/Cmd+C to copy the selection." : "复制失败，请按 Ctrl/Cmd+C 复制所选文字。"); }
  }
  function addToChat() {
    if (!passage) return;
    if (!onQuote(passage.text)) { setError(english ? "Shorten the selection or draft and try again." : "请缩短选区或草稿后重试。");return; }
    window.getSelection()?.removeAllRanges();clear();
  }
  const didCopy = copied === passage.text;
  return createPortal(<div ref={menuRef} role="group" aria-label={english ? "Selected text actions" : "选中文字操作"}
    onPointerDown={event => event.preventDefault()}
    className="fixed z-[80] w-56 max-w-[calc(100vw-16px)] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
    style={{ left: passage.left, top: passage.top }}>
    <div className="flex items-center gap-1">
      <button type="button" onClick={copySelection} aria-label={english ? "Copy selected text" : "复制选中文字"} className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs hover:bg-muted focus-visible:outline focus-visible:outline-2">
        {didCopy ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{didCopy ? english ? "Copied" : "已复制" : english ? "Copy" : "复制"}
      </button>
      <button type="button" onClick={addToChat} className="flex min-h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs hover:bg-muted focus-visible:outline focus-visible:outline-2"><MessageSquarePlus size={14} aria-hidden="true" />{english ? "Add to chat" : "添加到对话"}</button>
    </div>
    {error && <p role="alert" className="px-2 py-1 text-xs text-destructive">{error}</p>}
  </div>, document.body);
}
