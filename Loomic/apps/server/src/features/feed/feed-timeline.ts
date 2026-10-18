export type FeedTimelineShot = {
  id: string;
  startSecond: number;
  endSecond: number;
  subtitle?: string;
  voiceover?: string;
};

export type FeedTimelineArtifact = {
  id: string;
  artifactType: string;
  assetId: string;
  mediaType: "image" | "video";
  objectPath: string;
  bucket: string;
  mimeType: string | null;
  title: string;
  metadata: Record<string, unknown>;
};

export type FeedTimeline = {
  format: "helstera-timeline-v1";
  packageId: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution: { width: number | null; height: number | null };
  status: "ready" | "partial";
  artifactRefs: string[];
  tracks: Array<{
    type: "video" | "image" | "subtitle" | "voiceover" | "music";
    items: Array<Record<string, unknown>>;
  }>;
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  return asNumber(metadata[key]);
}

export function buildFeedTimeline(input: {
  packageId: string;
  durationSeconds: number;
  structure: Record<string, unknown> | null;
  artifacts: FeedTimelineArtifact[];
}): FeedTimeline {
  const shots = Array.isArray(input.structure?.shots) ? input.structure.shots : [];
  const typedShots = shots.filter((shot): shot is FeedTimelineShot => {
    if (!shot || typeof shot !== "object") return false;
    const candidate = shot as Record<string, unknown>;
    return typeof candidate.id === "string" && typeof candidate.startSecond === "number" && typeof candidate.endSecond === "number";
  });
  const width = input.artifacts.map((item) => metadataNumber(item.metadata, "width")).find((value) => value !== null) ?? null;
  const height = input.artifacts.map((item) => metadataNumber(item.metadata, "height")).find((value) => value !== null) ?? null;
  const aspectRatio = typeof input.structure?.aspectRatio === "string"
    ? input.structure.aspectRatio
    : width && height
      ? `${width}:${height}`
      : "unknown";
  const hasImage = input.artifacts.some((item) => item.mediaType === "image");
  const hasVideo = input.artifacts.some((item) => item.mediaType === "video");

  return {
    format: "helstera-timeline-v1",
    packageId: input.packageId,
    durationSeconds: input.durationSeconds,
    aspectRatio,
    resolution: { width, height },
    status: hasImage && hasVideo ? "ready" : "partial",
    artifactRefs: input.artifacts.map((item) => item.assetId),
    tracks: [
      {
        type: "video",
        items: input.artifacts.filter((item) => item.mediaType === "video").map((item) => ({
          id: item.id,
          assetId: item.assetId,
          artifactType: item.artifactType,
          objectPath: item.objectPath,
          title: item.title,
          start: 0,
          end: input.durationSeconds,
          mimeType: item.mimeType,
        })),
      },
      {
        type: "image",
        items: input.artifacts.filter((item) => item.mediaType === "image").map((item) => ({
          id: item.id,
          assetId: item.assetId,
          artifactType: item.artifactType,
          objectPath: item.objectPath,
          title: item.title,
          start: 0,
          end: input.durationSeconds,
          mimeType: item.mimeType,
        })),
      },
      {
        type: "subtitle",
        items: typedShots.map((shot) => ({
          id: shot.id,
          start: shot.startSecond,
          end: shot.endSecond,
          text: shot.subtitle ?? "",
        })),
      },
      {
        type: "voiceover",
        items: typedShots.map((shot) => ({
          id: `voiceover-${shot.id}`,
          start: shot.startSecond,
          end: shot.endSecond,
          text: shot.voiceover ?? "",
          placeholder: true,
          assetId: null,
        })),
      },
      {
        type: "music",
        items: [{
          id: "music-placeholder",
          start: 0,
          end: input.durationSeconds,
          placeholder: true,
          assetId: null,
        }],
      },
    ],
  };
}

export function buildSubtitleSrt(shots: FeedTimelineShot[]): string {
  return shots.map((shot, index) => `${index + 1}\n${formatSrtTime(shot.startSecond)} --> ${formatSrtTime(shot.endSecond)}\n${shot.subtitle ?? ""}\n`).join("\n");
}

function formatSrtTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},000`;
}

export function mediaExtension(mimeType: string | null, objectPath: string): string {
  const suffix = objectPath.split(".").pop();
  if (suffix && /^[a-z0-9]{1,5}$/i.test(suffix)) return suffix.toLowerCase();
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/mp4") return "mp4";
  return mimeType?.startsWith("video/") ? "mp4" : "png";
}
