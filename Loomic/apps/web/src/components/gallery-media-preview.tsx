"use client";

import { useState } from "react";

export function GalleryMediaPreview({
  url,
  title,
  type,
  caption,
}: {
  url: string;
  title: string;
  type: "image" | "video";
  caption?: { url: string; language: string; label: string } | null;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  function failPreview() {
    setFailed(true);
  }
  function retryPreview() {
    setFailed(false);
    setAttempt((value) => value + 1);
  }
  if (failed)
    return (
      <div
        role="alert"
        className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-8 text-center text-sm text-muted-foreground"
      >
        <p>作品媒体暂时无法读取，可能已取消公开或到期。</p>
        <button
          type="button"
          onClick={retryPreview}
          className="rounded-md border px-3 py-2 hover:bg-background"
        >
          重新加载媒体
        </button>
      </div>
    );
  return type === "video" ? (
    <video
      key={attempt}
      src={url}
      controls
      preload="metadata"
      onError={failPreview}
      className="max-h-[560px] w-full object-cover"
      aria-label={title}
    >
      {caption ? (
        <track
          key={caption.url}
          kind="captions"
          src={caption.url}
          srcLang={caption.language}
          label={caption.label}
          default
        />
      ) : null}
    </video>
  ) : (
    <img
      key={attempt}
      src={url}
      alt={title}
      loading="lazy"
      onError={failPreview}
      className="max-h-[680px] w-full object-cover"
    />
  );
}
