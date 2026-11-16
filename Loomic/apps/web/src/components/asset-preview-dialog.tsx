"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { preparePrivateMedia } from "@/lib/private-media";
import type { GeneratedAsset } from "@/lib/server-api";
import { Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

type AssetPreviewDialogProps = {
  asset: GeneratedAsset | null;
  accessToken: string;
  onOpenChange(open: boolean): void;
  onDownload(asset: GeneratedAsset): void;
};

export function AssetPreviewDialog({
  asset,
  accessToken,
  onOpenChange,
  onDownload,
}: AssetPreviewDialogProps) {
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  // Retry is a deliberate trigger for reloading the same asset URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt restarts this request after the retry command
  useEffect(() => {
    setSource("");
    setError("");
    if (!asset) return;
    const sourceUrl = asset.url;
    if (!sourceUrl) {
      setError("原文件地址不可用；请刷新资产列表后重试。");
      return;
    }
    if (asset.assetObjectId && !accessToken) {
      setError("登录状态已失效，请重新登录后预览。");
      return;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30_000);
    void (async () => {
      try {
        const media = asset.assetObjectId
          ? await preparePrivateMedia(
              asset.assetObjectId,
              accessToken,
              controller.signal,
            )
          : {
              path: sourceUrl,
              mimeType:
                asset.mimeType ??
                (asset.mediaType === "video"
                  ? "video/unknown"
                  : "image/unknown"),
            };
        if (controller.signal.aborted) return;
        const isExpectedMedia =
          asset.mediaType === "video"
            ? media.mimeType.startsWith("video/")
            : media.mimeType.startsWith("image/");
        if (!isExpectedMedia)
          throw new Error("素材类型与资产记录不一致，无法预览原文件。");
        setSource(media.path);
      } catch (cause) {
        if (controller.signal.aborted) {
          if (timedOut) setError("预览读取超时，请重试或下载原文件。");
          return;
        }
        setError(
          cause instanceof Error
            ? cause.message
            : "预览读取失败，请重试或下载原文件。",
        );
      }
    })();

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [accessToken, asset, attempt]);

  const isPrivate = Boolean(asset?.assetObjectId);

  return (
    <Dialog open={Boolean(asset)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-24px)] max-w-5xl flex-col gap-4 overflow-hidden p-4 sm:p-6">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="truncate">
            {asset?.title?.trim() || "素材预览"}
          </DialogTitle>
          <DialogDescription>
            {asset?.mediaType === "video"
              ? "原视频流式播放，可拖动进度查看；"
              : "查看完整图片原件；"}
            原文件仍保留在素材库中。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-black/95 p-2 sm:p-4">
          {!source && !error && (
            <output className="text-sm text-white">正在读取原文件…</output>
          )}
          {source && asset?.mediaType === "video" && (
            <video
              key={`${asset.id}:${attempt}`}
              src={source}
              aria-label={asset.title?.trim() || "视频预览"}
              crossOrigin={isPrivate ? "use-credentials" : undefined}
              controls
              playsInline
              preload="metadata"
              className="max-h-[72dvh] max-w-full"
              onError={() =>
                setError("视频暂时无法播放；可重新获取播放权限或下载原文件。")
              }
            />
          )}
          {source && asset?.mediaType === "image" && (
            <img
              key={`${asset.id}:${attempt}`}
              src={source}
              crossOrigin={isPrivate ? "use-credentials" : undefined}
              alt={asset.title?.trim() || "素材原图"}
              className="max-h-[72dvh] max-w-full object-contain"
              onError={() => setError("图片原件读取失败；可重试或下载原文件。")}
            />
          )}
          {error && (
            <div className="flex max-w-md flex-col items-center gap-3 px-4 py-8 text-center text-white">
              <p role="alert" className="text-sm">
                {error}
              </p>
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/30 px-3 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <RefreshCw className="size-3.5" />
                重新读取预览
              </button>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end">
          {asset && (
            <button
              type="button"
              onClick={() => onDownload(asset)}
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Download className="size-3.5" />
              下载原文件
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
