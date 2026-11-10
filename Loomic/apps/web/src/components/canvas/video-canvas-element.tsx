"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { preparePrivateMedia } from "@/lib/private-media";

type VideoCanvasElementProps = {
  src: string;
  width: number;
  height: number;
  accessToken?: string;
  trimStart?: number;
  trimEnd?: number | undefined;
};

/**
 * Lightweight inline video player rendered inside Excalidraw embeddable elements.
 *
 * Behavior:
 * - Hover-to-play: auto-play (muted) on mouse enter, pause on mouse leave
 * - Click-to-toggle: clicking toggles play/pause
 * - Play icon overlay when paused
 * - Stops event propagation so Excalidraw canvas interactions are not affected
 */
export function VideoCanvasElement({
  src,
  width,
  height,
  accessToken,
  trimStart = 0,
  trimEnd,
}: VideoCanvasElementProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackSrc, setPlaybackSrc] = useState(src.includes("/api/uploads/") ? "" : src);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const endRef = useRef(trimEnd ?? Number.POSITIVE_INFINITY);
  endRef.current = trimEnd ?? Number.POSITIVE_INFINITY;

  useEffect(() => {
    setError("");
    if (!src.includes("/api/uploads/")) {
      setPlaybackSrc(src);
      return;
    }
    setPlaybackSrc("");
    if (!accessToken) { setError("登录后可播放此私有视频。"); return; }
    const assetId = src.match(/\/api\/uploads\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\/file(?:[?#]|$)/i)?.[1];
    if (!assetId) { setError("视频素材标识无效。"); return; }
    const abort = new AbortController();
    const grant = async () => {
      const media = await preparePrivateMedia(assetId, accessToken, AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]));
      if (abort.signal.aborted) return;
      if (!media.mimeType.startsWith("video/")) throw new Error("素材不是视频文件。");
      setPlaybackSrc(media.path);
    };
    const renew = () => { void grant().catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "视频读取失败，请重试。"); }); };
    renew();
    const timer = setInterval(() => { if (!document.hidden || videoRef.current?.paused === false) renew(); }, 240000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [accessToken, src, revision]);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.currentTime < trimStart || video.currentTime >= endRef.current) video.currentTime = trimStart;
    video.play().catch(() => {
      // Autoplay may be blocked by the browser; fail silently
    });
    setPlaying(true);
  }, [trimStart]);

  const pause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setPlaying(false);
  }, []);

  const handleMouseEnter = useCallback(() => {
    play();
  }, [play]);

  const handleMouseLeave = useCallback(() => {
    pause();
  }, [pause]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (playing) {
        pause();
      } else {
        play();
      }
    },
    [playing, play, pause],
  );

  // Prevent Excalidraw from capturing pointer/wheel events on the video area
  const stopPropagation = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video && video.currentTime >= endRef.current) {
      video.pause();
      video.currentTime = trimStart;
      setPlaying(false);
    }
  }, [trimStart]);


  return (
    <div
      data-canvas-video
      style={{ width, height }}
      className="group relative flex items-center justify-center overflow-hidden rounded-lg bg-black"
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      onPointerMove={stopPropagation}
      onWheel={stopPropagation}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <video
        ref={videoRef}
        src={playbackSrc || undefined}
        crossOrigin={src.includes("/api/uploads/") ? "use-credentials" : undefined}
        onError={() => setError("视频暂时无法播放，请重试加载。原文件仍保留。")}
        muted
        loop
        playsInline
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = trimStart; }}
        className="h-full w-full object-contain"
      />
      {!playbackSrc && !error && <p role="status" className="absolute text-sm text-white">正在加载视频…</p>}
      {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background p-3 text-foreground"><p role="alert" className="text-sm">{error}</p><button type="button" onClick={event => { event.stopPropagation(); setRevision(value => value + 1); }} className="min-h-9 rounded-md border px-3 text-xs">重试加载</button></div>}


      {/* Play icon overlay — visible when paused */}
      {!playing && playbackSrc && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 transition-all duration-300 duration-200">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
            <Play className="h-5 w-5 text-white" fill="white" />
          </div>
        </div>
      )}
    </div>
  );
}
