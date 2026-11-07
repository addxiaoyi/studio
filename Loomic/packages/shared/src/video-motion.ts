import { z } from "zod";

export const motionPropertySchema=z.enum(["opacity","x","y","scale","rotation"]);
export const motionEaseSchema=z.enum(["none","power1.inOut","power2.out","power2.in","sine.inOut"]);
export const motionTrackSchema=z.strictObject({
  property:motionPropertySchema,
  points:z.array(z.strictObject({timeMs:z.number().int().nonnegative(),value:z.number().finite(),ease:motionEaseSchema.default("none")})).min(2).max(20),
});
export const motionTracksSchema=z.array(motionTrackSchema).max(5);
export type MotionTrack=z.infer<typeof motionTrackSchema>;
export const videoTransitionSchema=z.strictObject({afterClip:z.number().int().nonnegative().max(19),durationMs:z.number().int().min(50).max(3000),style:z.enum(["fade","slide-left","slide-right"])});
export type VideoTransition=z.infer<typeof videoTransitionSchema>;

export function validateMotion(tracks:MotionTrack[],startMs:number,endMs:number){
  if(new Set(tracks.map(track=>track.property)).size!==tracks.length)throw new Error("同一属性只能有一组关键帧。");
  for(const track of tracks){
    let previous=-1;
    for(const point of track.points){
      if(point.timeMs<=previous||point.timeMs<startMs||point.timeMs>=endMs)throw new Error("关键帧须按时间递增且位于图层可见范围内。");
      const [min,max]=track.property==="opacity"?[0,1]:track.property==="scale"?[0.01,10]:track.property==="rotation"?[-3600,3600]:[-7680,7680];
      if(point.value<min!||point.value>max!)throw new Error("关键帧数值超出支持范围。");previous=point.timeMs;
    }
  }
}

export function validateTransitions(transitions:VideoTransition[],clips:{start:number;end:number}[]){
  if(new Set(transitions.map(item=>item.afterClip)).size!==transitions.length)throw new Error("同一衔接处只能有一个转场。");
  for(const transition of transitions){
    const left=clips[transition.afterClip],right=clips[transition.afterClip+1];
    if(!left||!right||transition.durationMs/1000>Math.min(left.end-left.start,right.end-right.start)/2)throw new Error("转场不得超过相邻较短片段的一半。");
  }
}
