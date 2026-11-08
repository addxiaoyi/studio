"use client";

import { useEffect, useState } from "react";
import { boundedResponseBlob } from "@/lib/bounded-response-blob";
import { getServerBaseUrl } from "@/lib/env";

const MAX_RECORDING_BYTES = 40 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AuthenticatedRecording({ assetId, accessToken, maxBytes = MAX_RECORDING_BYTES, label = "网站浏览录屏", kind = "video",downloadName }: { assetId: string; accessToken: string; maxBytes?: number; label?: string; kind?: "image" | "video";downloadName?:string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    const load = async () => {
      if (!UUID.test(assetId)) throw new Error("录屏素材标识无效。");
      const response = await fetch(`${getServerBaseUrl()}/api/uploads/${assetId}/file`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
        redirect: "error",
        credentials: "include",
      });
      if (!response.ok) throw new Error("无法读取录屏，请检查登录状态或素材权限。");
      const blob = await boundedResponseBlob(response, maxBytes);
      if (!blob.type.startsWith(kind + "/") || !blob.size) throw new Error("素材文件无效。");
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    };
    void load().catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "录屏加载失败。");
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, accessToken, maxBytes, kind]);

  if (error) return <div className="space-y-2"><p role="alert" className="text-xs text-destructive">{error}</p>{url && kind === "video" && <a href={url} download={downloadName ?? "recording.webm"} className="inline-flex min-h-9 items-center rounded-md border px-3 text-xs">下载原始录像</a>}</div>;
  if (!url) return <p role="status" className="text-xs text-muted-foreground">{kind === "image" ? "正在加载图像…" : "正在加载网站录屏..."}</p>;
  if (kind === "image") return <img src={url} alt={label} className="max-h-96 w-full rounded-lg object-contain" />;
  return <div className="space-y-2"><video controls preload="metadata" src={url} onError={() => setError("当前播放器无法解码此录像。可下载原始文件，或使用新版录制重新生成。")} className="w-full rounded-lg border border-border/40" aria-label={label} />{downloadName&&<a href={url} download={downloadName} className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs">下载 WebM 演示录像</a>}</div>;
}
