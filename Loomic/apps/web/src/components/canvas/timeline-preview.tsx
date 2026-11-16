"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { preparePrivateMedia } from "@/lib/private-media";
import {
  timelineVisual,
  type CanvasTimeline,
  type CanvasTimelineItem,
} from "@/lib/canvas-timeline";
import { publishTimelineTime, type TimelineUiClock } from "@/lib/timeline-clock";

function privateUploadAssetId(item: CanvasTimelineItem) {
  return (
    item.assetId ??
    item.sourceUrl?.match(
      /\/api\/uploads\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\/file(?:[?#]|$)/i,
    )?.[1]
  );
}

function usePreviewSource(item: CanvasTimelineItem | undefined, token: string) {
  const [resolved, setResolved] = useState({ id: "", source: "", error: "" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    setResolved({ id: item?.id ?? "", source: "", error: "" });
    if (!item) return;
    if (item.dataUrl?.startsWith("data:")) {
      setResolved({ id: item.id, source: item.dataUrl, error: "" });
      return;
    }
    const assetId = privateUploadAssetId(item);
    if (!assetId) {
      setResolved({ id: item.id, source: item.sourceUrl ?? "", error: "" });
      return;
    }
    const abort = new AbortController();
    void preparePrivateMedia(assetId, token, AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]))
      .then((media) => {
        if (abort.signal.aborted) return;
        setResolved({ id: item.id, source: media.path, error: "" });
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
    };
  }, [item?.id, item?.assetId, item?.sourceUrl, item?.dataUrl, token, attempt]);
  const current = resolved.id === item?.id ? resolved : { source: "", error: "" };
  return {
    ...current,
    attempt,
    retry,
  };
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
  onError(message: string, retry: () => void): void;
}) {
  const audio = useRef<HTMLAudioElement>(null),
    { source, error, attempt, retry } = usePreviewSource(item, token);
  useEffect(() => {
    if (error) onError(error, retry);
  }, [error, onError, retry]);
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
          onError(`无法播放${item.title}，请检查音频或重新点击预览。`, retry),
        );
  }, [time, playing, source, item, onError, retry]);
  return source ? (
    <audio
      key={`${item.id}:${attempt}`}
      ref={audio}
      src={source}
      crossOrigin={privateUploadAssetId(item) ? "use-credentials" : undefined}
      preload="metadata"
      aria-label={`${item.title}同步音轨`}
      onError={() => onError(`音频无法读取：${item.title}。请重试或检查原文件。`, retry)}
    />
  ) : null;
}

export function CanvasTimelinePreview({
  timeline,
  token,
}: { timeline: CanvasTimeline; token: string }) {
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState(""),
    [retryAction, setRetryAction] = useState<() => void>(() => () => undefined);
  const video = useRef<HTMLVideoElement>(null),
    clock = useRef({ mediaTime: 0, at: 0 }),
    uiClock = useRef<TimelineUiClock>({ lastAt: 0, lastTime: -1 });
  const visual = timelineVisual(timeline, time),
    {
      source,
      error: sourceError,
      attempt: sourceAttempt,
      retry: retrySource,
    } = usePreviewSource(visual, token);
  const end = visual
    ? visual.start + visual.trimEnd - visual.trimStart
    : timeline.duration;
  useEffect(() => {
    if (sourceError) {
      setError(sourceError);
      setRetryAction(() => retrySource);
      setPlaying(false);
    }
  }, [sourceError, retrySource]);

  useEffect(() => {
    setError("");
    setRetryAction(() => retrySource);
  }, [visual?.id, retrySource]);

  const showPreviewError = useCallback(
    (message: string, retry: () => void) => {
      setError(message);
      setRetryAction(() => retry);
    },
    [],
  );
  useEffect(() => {
    setTime((current) => Math.min(current, timeline.duration));
    uiClock.current = { lastAt: 0, lastTime: -1 };
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
        showPreviewError("视频无法播放，请检查素材后重试预览。", retrySource);
        setPlaying(false);
      });
    else player.pause();
  }, [playing, source, visual?.id, retrySource, showPreviewError]);
  useEffect(() => {
    if (!playing || (visual && !source)) return;
    let frame = 0;
    function tick(now: number) {
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
        if (publishTimelineTime(uiClock.current, timeline.duration, now, true)) {
          setTime(timeline.duration);
        }
        setPlaying(false);
        return;
      }
      const nextTime = Math.max(0, next);
      if (publishTimelineTime(uiClock.current, nextTime, now)) setTime(nextTime);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, source, visual?.id, end, timeline.duration]);
  function seek(value: number) {
    setPlaying(false);
    uiClock.current = { lastAt: performance.now(), lastTime: value };
    setTime(value);
    const target = timelineVisual(timeline, value);
    if (video.current && target && target.id === visual?.id)
      video.current.currentTime = target.trimStart + value - target.start;
  }
  function toggle() {
    setError("");
    if (time >= timeline.duration) {
      uiClock.current = { lastAt: performance.now(), lastTime: 0 };
      setTime(0);
    }
    setPlaying((value) => !value);
  }
  function retryPreview() {
    setError("");
    setPlaying(false);
    retryAction();
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
        {visual && !source && !sourceError && (
          <p role="status" className="p-3 text-sm text-white">
            正在读取预览素材…
          </p>
        )}
        {source && visual?.kind === "video" && (
          <video
            key={`${visual.id}:${sourceAttempt}`}
            ref={video}
            src={source}
            crossOrigin={privateUploadAssetId(visual) ? "use-credentials" : undefined}
            preload="metadata"
            playsInline
            className="h-full w-full object-contain"
            onError={() => {
              showPreviewError("视频无法解码，请更换素材。", retrySource);
              setPlaying(false);
            }}
          />
        )}
        {source && visual?.kind === "image" && (
          <img
            key={`${visual.id}:${sourceAttempt}`}
            src={source}
            alt={visual.title}
            className="h-full w-full object-contain"
            onError={() => showPreviewError("图片预览加载失败，请重试或下载原文件。", retrySource)}
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
            onError={showPreviewError}
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
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
          <button
            type="button"
            onClick={retryPreview}
            className="min-h-9 rounded-md border border-border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            重新获取预览
          </button>
        </div>
      )}
    </section>
  );
}
