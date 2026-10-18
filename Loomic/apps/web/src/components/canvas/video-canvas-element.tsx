"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

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
  const [playbackSrc, setPlaybackSrc] = useState(src);
  const endRef = useRef(trimEnd ?? Number.POSITIVE_INFINITY);
  endRef.current = trimEnd ?? Number.POSITIVE_INFINITY;

  useEffect(() => {
    if (!src.includes("/api/uploads/") || !accessToken) {
      setPlaybackSrc(src);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    void fetch(src, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((response) => {
        if (!response.ok) throw new Error(`视频加载失败（${response.status}）`);
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPlaybackSrc(objectUrl);
      })
      .catch((error) => {
        if (!cancelled) console.warn("[canvas-video] failed to load video:", error);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accessToken, src]);

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
      style={{ width, height }}
      className="relative flex items-center justify-center overflow-hidden rounded-lg bg-black"
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
        src={playbackSrc}
        muted
        loop
        playsInline
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = trimStart; }}
        className="h-full w-full object-contain"
      />

      {/* Play icon overlay — visible when paused */}
      {!playing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 transition-all duration-300 duration-200">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
            <Play className="h-5 w-5 text-white" fill="white" />
          </div>
        </div>
      )}
    </div>
  );
}
