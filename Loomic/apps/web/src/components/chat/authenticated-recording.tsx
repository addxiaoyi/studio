"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { preparePrivateMedia, type PrivateMedia } from "@/lib/private-media";

const MAX_RECORDING_BYTES = 40 * 1024 * 1024;
const LOAD_TIMEOUT = 30_000;

export function AuthenticatedRecording({ assetId, accessToken, maxBytes = MAX_RECORDING_BYTES, label = "网站浏览录屏", kind = "video",downloadName }: { assetId: string; accessToken: string; maxBytes?: number; label?: string; kind?: "image" | "video";downloadName?:string }) {
  const [media, setMedia] = useState<PrivateMedia | null>(null);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const resumeAt = useRef(0);
  const video = useRef<HTMLVideoElement>(null);
  const downloadFrame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {resumeAt.current=0;},[assetId,accessToken]);
  useEffect(() => {
    const abort = new AbortController();
    setMedia(null); setError(""); setWaiting(true);
    const timeout = setTimeout(() => { setError("素材连接超时，请重试；原文件仍可在素材库中恢复。"); abort.abort(); }, LOAD_TIMEOUT);
    void preparePrivateMedia(assetId, accessToken, abort.signal).then(next => {
      if (abort.signal.aborted) return;
      if (!next.mimeType.startsWith(kind + "/") || (kind === "image" && next.byteSize > maxBytes)) throw new Error("素材文件无效或图片过大。");
      setMedia(next);
    }).catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "素材读取失败，请重试。"); })
      .finally(() => clearTimeout(timeout));
    return () => { abort.abort(); clearTimeout(timeout); };
  }, [assetId, accessToken, attempt, kind, maxBytes]);
  useEffect(() => {
    if (!media) return;
    const abort = new AbortController();
    const timer = setInterval(() => {
      if (document.hidden && video.current?.paused !== false) return;
      void preparePrivateMedia(assetId,accessToken,AbortSignal.any([abort.signal,AbortSignal.timeout(15000)]))
        .catch(cause => {if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:"播放权限续期失败，请重试。");});
    }, 240000);
    return () => {abort.abort();clearInterval(timer);};
  }, [assetId,accessToken,media?.path]);
  useEffect(() => {
    if (!media || !waiting || error) return;
    const timeout = setTimeout(() => setError("视频缓冲超时，可以重试播放或下载原始文件。"), LOAD_TIMEOUT);
    return () => clearTimeout(timeout);
  }, [media, waiting, error]);
  const retry = () => { resumeAt.current = video.current?.currentTime ?? 0; setAttempt(value => value + 1); };
  const loaded = () => { setWaiting(false); setError(""); if (video.current && resumeAt.current) { video.current.currentTime = resumeAt.current; resumeAt.current = 0; } };
  const stalled = () => setWaiting(true);
  const failed = () => { setWaiting(false); setError("暂时无法播放这份素材，请重试或下载原始文件。权限与到期状态会重新核验。"); };
  async function download(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (downloading) return;
    setDownloading(true);
    try {
      const current = await preparePrivateMedia(assetId,accessToken,AbortSignal.timeout(30000));
      // A download from a configured API origin must not navigate the desktop's main window.
      if(downloadFrame.current) downloadFrame.current.src=current.path+"?download=1";
    } catch(cause) {setError(cause instanceof Error?cause.message:"下载连接超时，请重试。");}
    finally {setDownloading(false);}
  }
  return <div className="space-y-2">
    <iframe ref={downloadFrame} title="原始素材下载" hidden />
    {waiting && !error && <p role="status" className="text-xs text-muted-foreground">{media ? "正在缓冲，可边加载边播放…" : kind === "image" ? "正在读取图片权限…" : "正在读取录像权限…"}</p>}
    {media && (kind === "image" ? <img src={media.path} crossOrigin="use-credentials" alt={label} onLoad={loaded} onError={failed} className="max-h-96 w-full rounded-lg object-contain" /> :
      <video ref={video} key={attempt} crossOrigin="use-credentials" controls preload="metadata" src={media.path} onLoadedMetadata={loaded} onCanPlay={loaded} onWaiting={stalled} onPlaying={loaded} onError={failed} className="w-full rounded-lg border border-border/40" aria-label={label} />)}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {error && <Button size="sm" variant="outline" onClick={retry}>重试加载</Button>}
      {media && <a href={`${media.path}?download=1`} onClick={download} aria-disabled={downloading} download={downloadName ?? (kind === "video" ? "recording.webm" : "image")} className="inline-flex min-h-9 items-center rounded-md border px-3 text-xs">{downloading?"正在准备下载…":kind === "video" ? "下载原始录像" : "下载原图"}</a>}
    </div>
  </div>;
}
