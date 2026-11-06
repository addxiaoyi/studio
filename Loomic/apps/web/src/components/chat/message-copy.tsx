"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type PointerEvent } from "react";
import type { ContentBlock } from "@helstera/shared";
import { useLocale } from "@/lib/i18n";

async function writeMessage(text: string) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* Embedded browsers can reject the async API while native copy still works. */ }
  const focused = document.activeElement;
  const field = document.createElement("textarea");
  field.value = text;field.readOnly = true;field.className = "fixed left-0 top-0 h-px w-px opacity-0";
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}

export function focusMessage(event: PointerEvent<HTMLElement>) {
  if (event.button !== 0 || !(event.target instanceof Element)) return;
  if (event.target.closest("button,a,input,textarea,select,[contenteditable=true]")) return;
  event.currentTarget.focus({ preventScroll: true });
}

export function copyMessageSelection(event: ClipboardEvent<HTMLElement>) {
  const selection = window.getSelection();
  if (!selection?.toString() || !event.currentTarget.contains(selection.anchorNode) || !event.currentTarget.contains(selection.focusNode)) return;
  event.clipboardData.setData("text/plain", selection.toString());
  event.preventDefault();event.stopPropagation();
}

export function MessageCopy({ blocks }: { blocks: ContentBlock[] }) {
  const english = useLocale() === "en-US";
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  const text = blocks.filter(block => block.type === "text").map(block => block.text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").replace(/<\/?think>/gi, "")).join("\n\n").trim();
  if (!text) return null;
  const label = state === "copied" ? english ? "Copied" : "已复制" : english ? "Copy message" : "复制消息";
  async function copy() {
    clearTimeout(reset.current);setState("copying");
    try { await writeMessage(text);setState("copied");reset.current = setTimeout(() => setState("idle"), 2000); }
    catch { setState("failed"); }
  }
  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" onClick={copy} disabled={state === "copying"} aria-label={label} title={label} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2">
      {state === "copied" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{label}
    </button>
    {state === "failed" && <span role="alert" className="text-xs text-destructive">{english ? "Copy failed. Select the text and press Ctrl/Cmd+C." : "复制失败，请选中文字后按 Ctrl/Cmd+C。"}</span>}
  </div>;
}
