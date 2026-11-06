import { expect, it } from "vitest";
import { cutFrames, studioCutSource, validateStudioCut, type StudioCut } from "@/lib/studio-cut";

const cut: StudioCut = { format: "portrait", clips: [
  { id: "1", name: "first.webm", duration: 4, start: 1, end: 3 },
  { id: "2", name: 'second".mp4', duration: 5, start: 0.5, end: 2 },
] };
it("builds a continuous 30fps cut and safely quotes media names", () => {
  const source = studioCutSource(cut);
  expect(cutFrames(cut)).toBe(105);
  expect(source).toContain("from={0} durationInFrames={60}");
  expect(source).toContain("from={60} durationInFrames={45}");
  expect(source).toContain("trimBefore={30}");
  expect(source).toContain('staticFile("second\\\".mp4")');
});
it.each([NaN, Infinity, -1, 5])("rejects invalid clip starts: %s", start => {
  expect(() => validateStudioCut({ ...cut, clips: [{ ...cut.clips[0]!, start }] })).toThrow("裁剪范围");
});
it("rejects empty cuts before invoking an editor or desktop renderer", () => {
  expect(() => validateStudioCut({ format: "landscape", clips: [] })).toThrow("添加");
});

it("keeps caption text inert JSX and delays music on the timeline", () => {
  const text = '</div>{globalThis.alert("bad")}';
  const source = studioCutSource({ ...cut, captions: [{ text, startMs: 0, endMs: 1000 }], audio: [{ assetName: "music.wav", startMs: 1000, volume: 0.3 }] });
  expect(source).toContain(`{${JSON.stringify(text)}}`);
  expect(source).toContain('from={30}');
  expect(source).not.toContain("startFrom=");
});

it.each([
  { captions: [{ text: "bad", startMs: -1, endMs: 1000 }] },
  { captions: [{ text: "bad", startMs: 0, endMs: 9000 }] },
  { audio: [{ assetName: "music.wav", startMs: 9000, volume: 0.3 }] },
])("rejects layers outside the composition: %j", layers => {
  expect(() => validateStudioCut({ ...cut, ...layers })).toThrow();
});
