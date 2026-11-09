"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { readStudioAsset } from "@/lib/studio-media";
import {
  timelineVisual,
  type CanvasTimeline,
  type CanvasTimelineItem,
} from "@/lib/canvas-timeline";

function usePreviewSource(item: CanvasTimelineItem | undefined, token: string) {
  const [resolved, setResolved] = useState({ id: "", source: "", error: "" });
  useEffect(() => {
    setResolved({ id: item?.id ?? "", source: "", error: "" });
    if (!item) return;
    if (item.dataUrl?.startsWith("data:image/")) {
      setResolved({ id: item.id, source: item.dataUrl, error: "" });
      return;
    }
    if (!item.assetId) {
      setResolved({ id: item.id, source: item.sourceUrl ?? "", error: "" });
      return;
    }
    const abort = new AbortController();
    let url = "";
    void readStudioAsset(token, item.assetId, abort.signal)
      .then((file) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(file);
        setResolved({ id: item.id, source: url, error: "" });
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setResolved({
            id: item.id,
            source: "",
            error: cause instanceof Error ? cause.message : "素材预览失败。",
          });
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [item?.id, item?.assetId, item?.sourceUrl, item?.dataUrl, token]);
  return resolved.id === item?.id ? resolved : { source: "", error: "" };
}

function PreviewAudio({
  item,
  token,
  time,
  playing,
  onError,
}: {
  item: CanvasTimelineItem;
  token: string;
  time: number;
  playing: boolean;
  onError(message: string): void;
}) {
  const audio = useRef<HTMLAudioElement>(null),
    { source, error } = usePreviewSource(item, token);
  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);
  useEffect(() => {
    const player = audio.current;
    if (!player || !source) return;
    const offset = time - item.start,
      active = offset >= 0 && offset < item.trimEnd - item.trimStart;
    player.volume = Math.min(1, item.volume);
    if (!active || !playing) player.pause();
    if (!active) return;
    const target = item.trimStart + offset;
    if (Math.abs(player.currentTime - target) > 0.15)
      player.currentTime = target;
    if (playing && player.paused)
      void player
        .play()
        .catch(() =>
          onError(`无法播放${item.title}，请检查音频或重新点击预览。`),
        );
  }, [time, playing, source, item, onError]);
  return source ? (
    <audio
      ref={audio}
      src={source}
      preload="auto"
      aria-label={`${item.title}同步音轨`}
    />
  ) : null;
}

export function CanvasTimelinePreview({
  timeline,
  token,
}: { timeline: CanvasTimeline; token: string }) {
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null),
    clock = useRef({ mediaTime: 0, at: 0 });
  const visual = timelineVisual(timeline, time),
    { source, error: sourceError } = usePreviewSource(visual, token);
  const end = visual
    ? visual.start + visual.trimEnd - visual.trimStart
    : timeline.duration;
  useEffect(() => {
    if (sourceError) {
      setError(sourceError);
      setPlaying(false);
    }
  }, [sourceError]);
  useEffect(() => {
    setTime((current) => Math.min(current, timeline.duration));
  }, [timeline.duration]);
  useEffect(() => {
    const player = video.current;
    clock.current = { mediaTime: time, at: performance.now() };
    if (!player || visual?.kind !== "video" || !source) return;
    const target = visual.trimStart + time - visual.start;
    if (Math.abs(player.currentTime - target) > 0.2)
      player.currentTime = target;
    if (playing)
      void player.play().catch(() => {
        setError("视频无法播放，请检查素材后重试预览。");
        setPlaying(false);
      });
    else player.pause();
  }, [playing, source, visual?.id]);
  useEffect(() => {
    if (!playing || (visual && !source)) return;
    let frame = 0;
    function tick() {
      const player = video.current;
      let next: number;
      if (visual?.kind === "video") {
        if (!player || player.readyState < 2) {
          frame = requestAnimationFrame(tick);
          return;
        }
        next = visual.start + player.currentTime - visual.trimStart;
        if (player.ended || next >= end - 0.025) next = end;
      } else
        next =
          clock.current.mediaTime +
          (performance.now() - clock.current.at) / 1000;
      if (next >= timeline.duration) {
        setTime(timeline.duration);
        setPlaying(false);
        return;
      }
      setTime(Math.max(0, next));
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, source, visual?.id, end, timeline.duration]);
  function seek(value: number) {
    setPlaying(false);
    setTime(value);
    const target = timelineVisual(timeline, value);
    if (video.current && target && target.id === visual?.id)
      video.current.currentTime = target.trimStart + value - target.start;
  }
  function toggle() {
    setError("");
    if (time >= timeline.duration) setTime(0);
    setPlaying((value) => !value);
  }
  const captions = timeline.items.filter(
    (item) =>
      item.kind === "subtitle" && time >= item.trimStart && time < item.trimEnd,
  );
  return (
    <section aria-label="时间线合成预览" className="mt-3 space-y-2">
      <div
        className={`relative mx-auto overflow-hidden rounded-lg bg-black ${timeline.format === "portrait" ? "aspect-[9/16] max-h-64 w-36" : "aspect-video max-h-56 w-full"}`}
      >
        {visual && !source && (
          <p role="status" className="p-3 text-sm text-white">
            正在读取预览素材…
          </p>
        )}
        {source && visual?.kind === "video" && (
          <video
            ref={video}
            src={source}
            preload="auto"
            playsInline
            className="h-full w-full object-contain"
            onError={() => {
              setError("视频无法解码，请更换素材。");
              setPlaying(false);
            }}
          />
        )}
        {source && visual?.kind === "image" && (
          <img
            src={source}
            alt={visual.title}
            className="h-full w-full object-contain"
          />
        )}
        {captions.map((caption) => (
          <p
            key={caption.id}
            className={`absolute left-[5%] right-[5%] whitespace-pre-wrap break-words text-center text-[clamp(12px,2vw,20px)] font-medium text-white [text-shadow:0_1px_4px_black] ${caption.style === "title" ? "top-[8%]" : caption.style === "emphasis" ? "bottom-[22%]" : "bottom-[8%]"}`}
          >
            {caption.title}
          </p>
        ))}
      </div>
      {timeline.items
        .filter((item) => item.kind === "audio")
        .map((item) => (
          <PreviewAudio
            key={item.id}
            item={item}
            token={token}
            time={time}
            playing={playing}
            onError={setError}
          />
        ))}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={!timeline.duration}
          aria-label={playing ? "暂停预览" : "播放预览"}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <input
          aria-label="时间线播放头"
          type="range"
          min={0}
          max={timeline.duration || 1}
          step={0.01}
          value={time}
          onChange={(event) => seek(Number(event.target.value))}
          className="min-w-0 flex-1"
        />
        <span className="text-xs tabular-nums">
          {time.toFixed(1)} / {timeline.duration.toFixed(1)}s
        </span>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
