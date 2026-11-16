"use client";

import type { LibraryPrompt } from "@/lib/prompt-library";
import { Check, Copy, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const COPIED_NOTICE_MS = 1500;

export function PromptLibraryCard({
  prompt,
  onSelect,
}: {
  prompt: LibraryPrompt;
  onSelect: (prompt: LibraryPrompt) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const notice = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const abort = new AbortController();
    lifetime.current = abort;
    return () => {
      abort.abort();
      clearTimeout(notice.current);
    };
  }, []);

  async function copyPrompt() {
    if (pending.current) return;
    pending.current = true;
    setCopying(true);
    setCopied(false);
    setError("");
    const signal = lifetime.current?.signal;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(prompt.prompt);
      if (signal?.aborted) return;
      setCopied(true);
      clearTimeout(notice.current);
      notice.current = setTimeout(() => setCopied(false), COPIED_NOTICE_MS);
    } catch {
      if (!signal?.aborted)
        setError("复制失败，请重试或选择下方文字手动复制。");
    } finally {
      pending.current = false;
      if (!signal?.aborted) setCopying(false);
    }
  }

  function choosePrompt() {
    onSelect(prompt);
  }

  return (
    <article
      aria-label={prompt.title}
      className="rounded-lg border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{prompt.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {prompt.category || "通用"}
            {prompt.source ? ` · ${prompt.source}` : ""}
            {prompt.license ? ` · ${prompt.license}` : ""}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="复制提示词"
            title="复制提示词"
            onClick={copyPrompt}
            disabled={copying}
            className="rounded-md p-2 hover:bg-muted disabled:opacity-50"
          >
            {copied ? (
              <Check className="size-4 text-green-600" />
            ) : (
              <Copy className="size-4" />
            )}
          </button>
          <button
            type="button"
            aria-label="使用提示词"
            title="使用提示词"
            onClick={choosePrompt}
            className="rounded-md bg-foreground p-2 text-background"
          >
            <WandSparkles className="size-4" />
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {copied ? (
        <output className="mt-3 block text-xs text-muted-foreground">
          已复制提示词
        </output>
      ) : null}
      <p
        className={`mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground ${error ? "" : "line-clamp-6"}`}
      >
        {prompt.prompt}
      </p>
      {prompt.tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1">
          {[...new Set(prompt.tags)].slice(0, 6).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
