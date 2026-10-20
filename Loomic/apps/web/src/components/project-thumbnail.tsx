"use client";

import { ImageOff, LayoutTemplate } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type PreviewState = "loading" | "ready" | "fallback";

type ProjectThumbnailProps = {
  src?: string | null;
  alt: string;
  className?: string;
};

export function ProjectThumbnail({ src, alt, className }: ProjectThumbnailProps) {
  const safeSrc = src && !src.includes("/api/uploads/") ? src : null;
  const [state, setState] = useState<PreviewState>(safeSrc ? "loading" : "fallback");

  useEffect(() => {
    setState(safeSrc ? "loading" : "fallback");
  }, [safeSrc]);

  const hasImage = Boolean(safeSrc) && state !== "fallback";

  return (
    <div
      className={cn("relative isolate overflow-hidden bg-muted/60", className)}
      role={hasImage ? undefined : "img"}
      aria-label={hasImage ? undefined : `${alt}：${safeSrc ? "预览暂不可用" : "暂无预览"}`}
    >
      {hasImage ? (
        <img
          src={safeSrc ?? undefined}
          alt={alt}
          className={cn("h-full w-full object-contain", state === "ready" ? "opacity-100" : "opacity-0")}
          loading="lazy"
          decoding="async"
          onLoad={() => setState("ready")}
          onError={() => setState("fallback")}
        />
      ) : null}

      {state === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center" aria-live="polite">
          <div className="flex items-center gap-2 rounded-full border border-border/60 bg-background/85 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm">
            <LayoutTemplate className="size-3.5" aria-hidden="true" />
            正在读取预览
          </div>
        </div>
      ) : null}

      {state === "fallback" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--muted)_82%,transparent),color-mix(in_oklab,var(--background)_78%,transparent))] px-4 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl border border-border/60 bg-background/70 text-muted-foreground shadow-sm">
            {safeSrc ? <ImageOff className="size-5" aria-hidden="true" /> : <LayoutTemplate className="size-5" aria-hidden="true" />}
          </span>
          <span className="text-xs font-medium text-foreground">
            {safeSrc ? "预览暂不可用" : "暂无预览"}
          </span>
          <span className="text-[11px] text-muted-foreground">打开画布后会自动生成预览</span>
        </div>
      ) : null}
    </div>
  );
}
