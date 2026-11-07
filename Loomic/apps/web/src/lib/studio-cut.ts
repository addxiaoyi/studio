import { validateTransitions, type VideoTransition } from "@helstera/shared";
export type StudioMedia = { name: string; mimeType: string };
export type StudioClip = { id: string; name: string; duration: number; start: number; end: number };
export type StudioCaption = { text: string; startMs: number; endMs: number };
export type StudioAudio = { assetName: string; startMs: number; volume: number };
export type StudioImage = {assetName:string;startMs:number;endMs:number;fit:"contain"|"cover"};
export type StudioCut = { format: "portrait" | "landscape"; clips: StudioClip[]; captions?: StudioCaption[]; audio?: StudioAudio[];images?:StudioImage[];transitions?:VideoTransition[] };
export const STUDIO_FPS = 30;

export function cutFrames(cut: StudioCut) {
  return cut.clips.reduce((frames, clip) => frames + Math.max(1, Math.round((clip.end - clip.start) * STUDIO_FPS)), 0)-(cut.transitions??[]).reduce((frames,item)=>frames+Math.round(item.durationMs/1000*STUDIO_FPS),0);
}

export function validateStudioCut(cut: StudioCut): void {
  if (!["portrait", "landscape"].includes(cut.format) || !cut.clips.length || cut.clips.length > 100) throw new Error("请选择画幅并添加 1 至 100 个视频片段。");
  for (const clip of cut.clips) {
    if (!clip.name || ![clip.start, clip.end, clip.duration].every(Number.isFinite)
      || clip.start < 0 || clip.end > clip.duration || clip.end - clip.start < 1 / STUDIO_FPS) {
      throw new Error("片段裁剪范围无效，请检查开始和结束时间。");
    }
  }
  validateTransitions(cut.transitions??[],cut.clips);
  const durationMs = cutFrames(cut)/STUDIO_FPS*1000;
  if ((cut.captions?.length ?? 0) > 100 || (cut.audio?.length ?? 0) > 8) throw new Error("字幕或音轨数量超出限制。");
  for (const caption of cut.captions ?? []) {
    if (!caption.text.trim() || caption.text.length > 500 || !Number.isInteger(caption.startMs) || caption.startMs < 0 || !Number.isInteger(caption.endMs) || caption.endMs <= caption.startMs || caption.endMs > durationMs) throw new Error("字幕时间范围无效。");
  }
  for (const audio of cut.audio ?? []) {
    if (!audio.assetName || !Number.isInteger(audio.startMs) || audio.startMs < 0 || audio.startMs >= durationMs || !Number.isFinite(audio.volume) || audio.volume < 0 || audio.volume > 2) throw new Error("背景音乐参数无效。");
  }
  for(const image of cut.images??[])if(!image.assetName||image.startMs<0||image.endMs<=image.startMs||image.endMs>durationMs)throw new Error("图片显示时间超出视频。");
}

export function studioCutSource(cut: StudioCut, options: { layersOnly?: boolean; fps?: number } = {}): string {
  validateStudioCut(cut);
  const fps = options.fps ?? STUDIO_FPS;
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("合成帧率无效。");
  let position = 0;
  const sequences = (options.layersOnly ? [] : cut.clips).map((clip,index) => {
    const frames = Math.max(1, Math.round((clip.end - clip.start) * fps));
    const transition=cut.transitions?.find(item=>item.afterClip===index-1);
    if(transition)position-=Math.round(transition.durationMs/1000*fps);
    const video=`<Video src={staticFile(${JSON.stringify(clip.name)})} trimBefore={${Math.round(clip.start * fps)}} style={{width:"100%",height:"100%",objectFit:"contain"}} />`;
    const tracks=transition?[{property:transition.style==="fade"?"opacity":"x",points:[{timeMs:0,value:transition.style==="fade"?0:(cut.format==="portrait"?720:1280)*(transition.style==="slide-left"?1:-1),ease:"none"},{timeMs:transition.durationMs,value:transition.style==="fade"?1:0,ease:"none"}]}]:[];
    const content=transition?`<LoomicMotion tracksJson={${JSON.stringify(JSON.stringify(tracks))}}><AbsoluteFill style={{backgroundColor:"black"}}>${video}</AbsoluteFill></LoomicMotion>`:video;
    const source = `<Sequence from={${position}} durationInFrames={${frames}} name={${JSON.stringify(clip.name)}}>${content}</Sequence>`;
    position += frames;
    return source;
  });
  const captions = (cut.captions ?? []).map((caption) => {
    const from = Math.round(caption.startMs / 1000 * fps);
    const duration = Math.max(1, Math.round((caption.endMs - caption.startMs) / 1000 * fps));
    return `<Sequence from={${from}} durationInFrames={${duration}} name="字幕"><div style={{position:"absolute",bottom:80,left:40,right:40,color:"white",fontSize:42,textAlign:"center",textShadow:"0 2px 6px black",fontFamily:"'Microsoft YaHei','PingFang SC',sans-serif",whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{${JSON.stringify(caption.text)}}</div></Sequence>`;
  }).join("\n");
  const audio = (cut.audio ?? []).map((item) => `<Sequence from={${Math.round(item.startMs / 1000 * fps)}} layout="none" name="背景音乐"><Audio src={staticFile(${JSON.stringify(item.assetName)})} volume={${item.volume}} /></Sequence>`).join("\n");
  const images=(cut.images??[]).map(image=>`<Sequence from={${Math.round(image.startMs/1000*fps)}} durationInFrames={${Math.max(1,Math.round((image.endMs-image.startMs)/1000*fps))}} name={${JSON.stringify(image.assetName)}}><Img src={staticFile(${JSON.stringify(image.assetName)})} style={{width:"100%",height:"100%",objectFit:${JSON.stringify(image.fit)}}}/></Sequence>`).join("\n");
  return `import {AbsoluteFill, Sequence, staticFile, Img} from "remotion";\nimport {Audio, Video} from "@remotion/media";\n${cut.transitions?.length?'import {LoomicMotion} from "/project/src/loomic-motion";\n':""}export const LoomicCut = () => <AbsoluteFill style={{backgroundColor:${JSON.stringify(options.layersOnly ? "transparent" : "black")}}}>${sequences.join("\n")}${images}${captions}${audio}</AbsoluteFill>;\n`;
}
