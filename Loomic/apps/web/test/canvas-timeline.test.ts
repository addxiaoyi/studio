import { expect, it } from "vitest";
import {
  canvasTimelineManifest,
  readCanvasTimeline,
  timelineVisual,
} from "@/lib/canvas-timeline";
import { canvasTimelineSource } from "@/lib/canvas-timeline-source";

it("uses one sequential visual clock and retains private material identity in manifests", () => {
  const timeline = readCanvasTimeline(
    [
      {
        id: "excluded",
        type: "image",
        customData: { timelineIncluded: false },
      },
      {
        id: "image",
        type: "image",
        fileId: "image-file",
        customData: { timelineDuration: 4 },
      },
      {
        id: "video",
        type: "embeddable",
        customData: {
          isVideo: true,
          assetId: "private-video",
          durationSeconds: 130,
          trimStart: 100,
          trimEnd: 125,
        },
      },
      {
        id: "audio",
        type: "rectangle",
        customData: {
          isAudio: true,
          audioAssetId: "private-audio",
          durationSeconds: 90,
          trimStart: 5,
          trimEnd: 25,
          timelineStart: 2,
          timelineVolume: 0.3,
        },
      },
      {
        id: "caption",
        type: "text",
        text: "竖屏字幕",
        customData: {
          isSubtitle: true,
          subtitleStart: 8,
          subtitleEnd: 20,
          subtitleStyle: "title",
        },
      },
    ],
    { "image-file": { dataURL: "data:image/png;base64,aA==" } },
    "canvas",
  );
  expect(timeline.duration).toBe(29);
  expect(timelineVisual(timeline, 4)?.id).toBe("video");
  const manifest = canvasTimelineManifest(timeline);
  expect(manifest.items.map((item) => item.id)).toEqual([
    "image",
    "video",
    "audio",
    "caption",
  ]);
  expect(manifest.items[1]).toMatchObject({
    assetId: "private-video",
    start: 4,
  });
  const source = canvasTimelineSource(timeline, {
    image: "image.png",
    video: "video.webm",
    audio: "voice.wav",
  });
  expect(source).toContain("trimBefore={150}");
  expect(source).toContain("volume={0.3}");
  expect(source).toContain('"top":"8%"');
  expect(source).toContain("from={120} durationInFrames={750}");
});
