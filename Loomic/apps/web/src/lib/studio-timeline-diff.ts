import type { StudioAiPlan } from "./studio-ai-edit";
import type { VideoEditorAction } from "@helstera/shared";

export type TimelineSpan = { id: string; label: string; start: number; end: number; actionIndex?: number; detail?: string; change: "existing" | "added" | "replaced" };
export type TimelineVersion = { duration: number; format: "portrait" | "landscape"; video: TimelineSpan[]; captions: TimelineSpan[]; audio: TimelineSpan[]; audioKnown: boolean };
export type TimelineDiff = { before: TimelineVersion; after: TimelineVersion; scale: number; exportPlanned: boolean; details: {index:number;action:VideoEditorAction;before:string}[] };

export function studioTimelineDiff(plan: StudioAiPlan, undone: readonly number[] = []): TimelineDiff | null {
  if (!plan.snapshot || !plan.commands) return null;
  const original = plan.snapshot;
  const commands = plan.commands.actions.map((action, index) => ({ action, index })).filter(({ index }) => !undone.includes(index));
  const cut = commands.find(({ action }) => action.type === "cut");
  const transitions=commands.filter(({action})=>action.type==="transition");
  let cursor = 0;
  const oldClips: TimelineSpan[] = original.cut?.clips.map((clip, index) => {
    const transition=original.cut?.transitions?.find(item=>item.afterClip===index-1);
    if(transition)cursor-=Math.round(transition.durationMs/1000*30)/30;
    const start = cursor;cursor += clip.end - clip.start;
    return { id: `before-video-${index}`, label: clip.name, start, end: cursor, detail: `${clip.start}–${clip.end}s`, change: "existing" };
  }) ?? [{ id: "before-video", label: original.compositionId, start: 0, end: original.duration, change: "existing" }];
  const before: TimelineVersion = { duration: original.duration, format: original.format, video: oldClips,
    captions: original.captions.map((caption, index) => ({ id: `before-caption-${index}`, label: caption.text, start: caption.startMs / 1000, end: caption.endMs / 1000, change: "existing" })),
    audio: (original.cut?.audio ?? []).map((track, index) => ({ id: `before-audio-${index}`, label: track.assetName, start: track.startMs / 1000, end: Math.min(original.duration, track.startMs / 1000 + (plan.mediaDurations?.[track.assetName] ?? original.duration)), detail: `${Math.round(track.volume * 100)}%`, change: "existing" })),
    audioKnown: original.cut !== null };
  cursor = 0;
  const clips=cut?.action.type==="cut"?cut.action.clips:transitions.length?original.cut?.clips:undefined;
  const combinedTransitions=[...(!cut?original.cut?.transitions??[]:[]).filter(item=>!transitions.some(({action})=>action.type==="transition"&&action.afterClip===item.afterClip)),...transitions.flatMap(({action})=>action.type==="transition"?[action]:[])];
  const newClips = clips ? clips.map((clip, index): TimelineSpan => {
    const overlap=combinedTransitions.find(item=>item.afterClip===index-1);
    if(overlap)cursor-=Math.round(overlap.durationMs/1000*30)/30;
    const start = cursor;cursor += Math.max(1, Math.round((clip.end - clip.start) * 30)) / 30;
    return { id: `after-video-${index}`, label: clip.name, start, end: cursor, actionIndex: cut?.index??transitions[0]!.index, detail: `${clip.start}–${clip.end}s`, change: "replaced" };
  }) : oldClips.map(span=>({...span}));
  const duration = clips ? cursor : original.duration;
  const after: TimelineVersion = { duration, format: cut?.action.type === "cut" ? cut.action.format : original.format, video: newClips,
    captions: cut ? [] : before.captions.map(span=>({...span})), audio: cut ? [] : before.audio.map(span=>({...span})), audioKnown: Boolean(cut) || before.audioKnown };
  const details:TimelineDiff["details"]=[];
  for (const { action, index } of commands) {
    if(action.type==="resize"){
      after.format=action.width<action.height?"portrait":"landscape";
      details.push({index,action,before:`${original.width??"?"} × ${original.height??"?"}`});
    }
    if(action.type==="keyframes")details.push({index,action,before:original.layers?.find(layer=>layer.id===action.layerId)?.motion?.length?"已有动画将替换":"静态图层"});
    if(action.type==="transition")details.push({index,action,before:"硬切"});
    if(action.type==="image")after.video.push({id:`image-${index}`,label:action.assetName,start:action.startMs/1000,end:action.endMs/1000,change:"added",actionIndex:index});
    if(action.type==="layer"){
      const layer=original.layers?.find(item=>item.id===action.layerId);
      details.push({index,action,before:layer?.text??layer?.label??action.layerId});
      const caption=after.captions.find(item=>layer&&item.label===layer.text&&item.start===layer.startMs/1000&&item.end===layer.endMs/1000);
      if(caption&&layer){
        if(action.changes.removed)after.captions=after.captions.filter(item=>item!==caption);
        else {caption.label=action.changes.text??caption.label;caption.start=(action.changes.startMs??layer.startMs)/1000;caption.end=(action.changes.endMs??layer.endMs)/1000;caption.change="replaced";caption.actionIndex=index;}
      }
    }
    if (action.type === "caption") after.captions.push({ id: `caption-${index}`, label: action.text, start: action.startMs / 1000, end: action.endMs / 1000, change: "added", actionIndex: index });
    if (action.type === "audio") after.audio.push({ id: `audio-${index}`, label: action.assetName, start: action.startMs / 1000, end: Math.min(duration, action.startMs / 1000 + (plan.mediaDurations?.[action.assetName] ?? duration)), detail: `${Math.round(action.volume * 100)}%`, change: "added", actionIndex: index });
  }
  return { before, after, scale: Math.max(before.duration, after.duration, 0.01), exportPlanned: commands.some(({action}) => action.type === "export"),details };
}
