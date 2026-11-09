export type CanvasTimelineItem = {
  id: string;
  title: string;
  kind: "image" | "video" | "subtitle" | "audio";
  assetId?: string;
  fileId?: string;
  sourceUrl?: string;
  dataUrl?: string;
  duration: number;
  start: number;
  trimStart: number;
  trimEnd: number;
  volume: number;
  style?: "bottom" | "title" | "emphasis";
};
export type CanvasTimeline = {
  version: 1;
  canvasId: string;
  format: "portrait" | "landscape";
  duration: number;
  items: CanvasTimelineItem[];
};
type Element = Record<string, unknown>;
const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;

export function readCanvasTimeline(
  elements: readonly Element[],
  files: Record<string, Record<string, unknown>> = {},
  canvasId = "",
): CanvasTimeline {
  let visualTime = 0;
  const items: CanvasTimelineItem[] = [];
  let format: CanvasTimeline["format"] = "landscape";
  for (const element of elements) {
    const meta = (element.customData ?? {}) as Record<string, unknown>;
    if (element.isDeleted || meta.timelineIncluded === false) continue;
    const kind = meta.isSubtitle
      ? "subtitle"
      : meta.isAudio
        ? "audio"
        : meta.isVideo
          ? "video"
          : element.type === "image"
            ? "image"
            : null;
    if (!kind) continue;
    const fileId = text(element.fileId),
      file = fileId ? files[fileId] : undefined;
    const duration =
      kind === "image"
        ? finite(meta.timelineDuration, 5)
        : finite(meta.durationSeconds, 0);
    const trimStart = Math.max(
      0,
      finite(kind === "subtitle" ? meta.subtitleStart : meta.trimStart, 0),
    );
    const trimEnd = finite(
      kind === "subtitle" ? meta.subtitleEnd : meta.trimEnd,
      kind === "subtitle" ? 5 : duration,
    );
    const start =
      kind === "subtitle"
        ? trimStart
        : kind === "audio"
          ? Math.max(0, finite(meta.timelineStart, 0))
          : visualTime;
    const sourceUrl =
      text(meta.audioUrl) ??
      text(meta.url) ??
      text(meta.storageUrl) ??
      text(element.link) ??
      text(file?.storageUrl);
    const assetId =
      text(meta.assetId) ??
      text(meta.audioAssetId) ??
      sourceUrl?.match(/\/api\/uploads\/([a-f\d-]{36})\/file/i)?.[1];
    const dataUrl = text(file?.dataURL);
    const item: CanvasTimelineItem = {
      id: String(element.id),
      title:
        text(element.text) ??
        text(meta.title) ??
        `${kind === "image" ? "图片" : "媒体"} ${items.length + 1}`,
      kind,
      duration,
      start,
      trimStart,
      trimEnd,
      volume: Math.min(2, Math.max(0, finite(meta.timelineVolume, 1))),
      ...(assetId ? { assetId } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(fileId ? { fileId } : {}),
      ...(dataUrl ? { dataUrl } : {}),
      ...(meta.subtitleStyle === "title" || meta.subtitleStyle === "emphasis"
        ? { style: meta.subtitleStyle }
        : { style: "bottom" }),
    };
    if (kind === "image" || kind === "video") {
      if (
        !items.some((prior) => prior.kind === "image" || prior.kind === "video")
      )
        format =
          finite(meta.mediaHeight, finite(element.height, 0)) >
          finite(meta.mediaWidth, finite(element.width, 0))
            ? "portrait"
            : "landscape";
      visualTime += Math.max(0, trimEnd - trimStart);
    }
    items.push(item);
  }
  const duration = Math.max(
    0,
    visualTime,
    ...items.map((item) =>
      item.kind === "subtitle"
        ? item.trimEnd
        : item.kind === "audio"
          ? item.start + item.trimEnd - item.trimStart
          : 0,
    ),
  );
  return { version: 1, canvasId, format, duration, items };
}

export function validateCanvasTimeline(timeline: CanvasTimeline) {
  if (
    !timeline.items.some(
      (item) => item.kind === "video" || item.kind === "image",
    )
  )
    throw new Error("先加入图片或视频，再创建成片。");
  if (
    timeline.items.length > 200 ||
    !Number.isFinite(timeline.duration) ||
    timeline.duration <= 0
  )
    throw new Error("时间线数量或时长无效。");
  for (const item of timeline.items) {
    if (
      ![item.trimStart, item.trimEnd, item.start].every(Number.isFinite) ||
      item.trimStart < 0 ||
      item.trimEnd <= item.trimStart
    )
      throw new Error(
        `${item.title} 的时间范围无效，请先读取真实时长或调整裁剪。`,
      );
    if (item.kind === "subtitle") continue;
    if (!item.assetId && !item.dataUrl)
      throw new Error(`${item.title} 缺少可恢复的素材，请先保存或重新导入。`);
    if (item.kind !== "image" && item.trimEnd > item.duration)
      throw new Error(`${item.title} 的出点超过真实时长。`);
  }
}

export function canvasTimelineManifest(timeline: CanvasTimeline) {
  validateCanvasTimeline(timeline);
  return {
    ...timeline,
    formatVersion: "helstera-timeline-v2",
    items: timeline.items.map((item) => {
      const { sourceUrl, dataUrl, ...track } = item;
      return { ...track, ...(!item.assetId && dataUrl ? { dataUrl } : {}) };
    }),
  };
}

export function timelineVisual(timeline: CanvasTimeline, time: number) {
  return timeline.items.find(
    (item) =>
      (item.kind === "video" || item.kind === "image") &&
      time >= item.start &&
      time < item.start + item.trimEnd - item.trimStart,
  );
}
