export type StudioMedia = { name: string; mimeType: string };
export type StudioClip = { id: string; name: string; duration: number; start: number; end: number };
export type StudioCaption = { text: string; startMs: number; endMs: number };
export type StudioAudio = { assetName: string; startMs: number; volume: number };
export type StudioCut = { format: "portrait" | "landscape"; clips: StudioClip[]; captions?: StudioCaption[]; audio?: StudioAudio[] };
export const STUDIO_FPS = 30;

export function cutFrames(cut: StudioCut) {
  return cut.clips.reduce((frames, clip) => frames + Math.max(1, Math.round((clip.end - clip.start) * STUDIO_FPS)), 0);
}

export function validateStudioCut(cut: StudioCut): void {
  if (!["portrait", "landscape"].includes(cut.format) || !cut.clips.length || cut.clips.length > 100) throw new Error("请选择画幅并添加 1 至 100 个视频片段。");
  for (const clip of cut.clips) {
    if (!clip.name || ![clip.start, clip.end, clip.duration].every(Number.isFinite)
      || clip.start < 0 || clip.end > clip.duration || clip.end - clip.start < 1 / STUDIO_FPS) {
      throw new Error("片段裁剪范围无效，请检查开始和结束时间。");
    }
  }
  const durationMs = Math.round(cut.clips.reduce((sum, clip) => sum + clip.end - clip.start, 0) * 1000);
  if ((cut.captions?.length ?? 0) > 100 || (cut.audio?.length ?? 0) > 8) throw new Error("字幕或音轨数量超出限制。");
  for (const caption of cut.captions ?? []) {
    if (!caption.text.trim() || caption.text.length > 500 || !Number.isInteger(caption.startMs) || caption.startMs < 0 || !Number.isInteger(caption.endMs) || caption.endMs <= caption.startMs || caption.endMs > durationMs) throw new Error("字幕时间范围无效。");
  }
  for (const audio of cut.audio ?? []) {
    if (!audio.assetName || !Number.isInteger(audio.startMs) || audio.startMs < 0 || audio.startMs >= durationMs || !Number.isFinite(audio.volume) || audio.volume < 0 || audio.volume > 2) throw new Error("背景音乐参数无效。");
  }
}

export function studioCutSource(cut: StudioCut, options: { layersOnly?: boolean; fps?: number } = {}): string {
  validateStudioCut(cut);
  const fps = options.fps ?? STUDIO_FPS;
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("合成帧率无效。");
  let position = 0;
  const sequences = (options.layersOnly ? [] : cut.clips).map(clip => {
    const frames = Math.max(1, Math.round((clip.end - clip.start) * fps));
    const source = `<Sequence from={${position}} durationInFrames={${frames}} name={${JSON.stringify(clip.name)}}><Video src={staticFile(${JSON.stringify(clip.name)})} trimBefore={${Math.round(clip.start * fps)}} style={{width:"100%",height:"100%",objectFit:"contain"}} /></Sequence>`;
    position += frames;
    return source;
  });
  const captions = (cut.captions ?? []).map((caption) => {
    const from = Math.round(caption.startMs / 1000 * fps);
    const duration = Math.max(1, Math.round((caption.endMs - caption.startMs) / 1000 * fps));
    return `<Sequence from={${from}} durationInFrames={${duration}} name="字幕"><div style={{position:"absolute",bottom:80,left:40,right:40,color:"white",fontSize:42,textAlign:"center",textShadow:"0 2px 6px black",fontFamily:"'Microsoft YaHei','PingFang SC',sans-serif",whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{${JSON.stringify(caption.text)}}</div></Sequence>`;
  }).join("\n");
  const audio = (cut.audio ?? []).map((item) => `<Sequence from={${Math.round(item.startMs / 1000 * fps)}} layout="none" name="背景音乐"><Audio src={staticFile(${JSON.stringify(item.assetName)})} volume={${item.volume}} /></Sequence>`).join("\n");
  return `import {AbsoluteFill, Sequence, staticFile} from "remotion";\nimport {Audio, Video} from "@remotion/media";\nexport const LoomicCut = () => <AbsoluteFill style={{backgroundColor:${JSON.stringify(options.layersOnly ? "transparent" : "black")}}}>${sequences.join("\n")}${captions}${audio}</AbsoluteFill>;\n`;
}
