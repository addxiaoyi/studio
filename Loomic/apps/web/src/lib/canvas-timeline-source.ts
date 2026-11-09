import { validateCanvasTimeline, type CanvasTimeline } from "./canvas-timeline";

export function canvasTimelineSource(
  timeline: CanvasTimeline,
  names: Record<string, string>,
) {
  validateCanvasTimeline(timeline);
  const frames = (seconds: number) => Math.max(0, Math.round(seconds * 30));
  // Keep captions above visuals regardless of when they were added to the canvas.
  const layers = [...timeline.items.filter(item => item.kind !== "subtitle"), ...timeline.items.filter(item => item.kind === "subtitle")];
  const tracks = layers.map((item) => {
    const duration = Math.max(1, frames(item.trimEnd - item.trimStart));
    if (item.kind === "subtitle") {
      const position =
        item.style === "title"
          ? { top: "8%" }
          : { bottom: item.style === "emphasis" ? "22%" : "8%" };
      return `<Sequence from={${frames(item.trimStart)}} durationInFrames={${duration}} name="字幕"><div style={${JSON.stringify({ position: "absolute", left: "5%", right: "5%", ...position, color: "white", fontSize: 42, textAlign: "center", whiteSpace: "pre-wrap", overflowWrap: "anywhere", textShadow: "0 2px 4px black", fontFamily: "Microsoft YaHei, PingFang SC, sans-serif" })}}>{${JSON.stringify(item.title)}}</div></Sequence>`;
    }
    const name = names[item.id];
    if (!name) throw new Error(`${item.title} 尚未导入编辑器。`);
    const src = `staticFile(${JSON.stringify(name)})`;
    const content =
      item.kind === "audio"
        ? `<Audio src={${src}} trimBefore={${frames(item.trimStart)}} volume={${item.volume}} />`
        : item.kind === "video"
          ? `<Video src={${src}} trimBefore={${frames(item.trimStart)}} style={{width:"100%",height:"100%",objectFit:"contain"}} />`
          : `<Img src={${src}} style={{width:"100%",height:"100%",objectFit:"contain"}} />`;
    return `<Sequence from={${frames(item.start)}} durationInFrames={${duration}} name={${JSON.stringify(item.title)}}>${content}</Sequence>`;
  });
  return `import {AbsoluteFill,Sequence,staticFile,Img} from "remotion";import {Video,Audio} from "@remotion/media";export const LoomicCut=()=> <AbsoluteFill style={{backgroundColor:"black"}}>${tracks.join("\n")}</AbsoluteFill>;`;
}
