import React, {cloneElement, type CSSProperties, type ReactElement} from "react";
import {useCurrentFrame,useVideoConfig} from "remotion";
import {gsap} from "./loomic-gsap.js";

type Track={property:string;points:{timeMs:number;value:number;ease:string}[]};
export function sampleMotion(tracks:Track[],timeMs:number):Record<string,number>{
  const values:Record<string,number>={};
  for(const track of tracks){
    const first=track.points[0]!,last=track.points[track.points.length-1]!;
    if(timeMs<=first.timeMs){values[track.property]=first.value;continue;}
    if(timeMs>=last.timeMs){values[track.property]=last.value;continue;}
    const next=track.points.findIndex(point=>point.timeMs>timeMs),a=track.points[next-1]!,b=track.points[next]!;
    values[track.property]=gsap.utils.interpolate(a.value,b.value,gsap.parseEase(b.ease)((timeMs-a.timeMs)/(b.timeMs-a.timeMs)));
  }
  return values;
}
export function LoomicMotion({children,tracksJson,offsetMs=0}:{children:ReactElement<{style?:CSSProperties}>;tracksJson:string;offsetMs?:number}){
  const frame=useCurrentFrame(),{fps}=useVideoConfig();
  const tracks:Track[]=JSON.parse(tracksJson);
  const values=sampleMotion(tracks,frame/fps*1000+offsetMs);
  const original=children.props.style??{};
  const transforms=[original.transform,values.x!==undefined?`translateX(${values.x}px)`:null,values.y!==undefined?`translateY(${values.y}px)`:null,values.scale!==undefined?`scale(${values.scale})`:null,values.rotation!==undefined?`rotate(${values.rotation}deg)`:null].filter(Boolean).join(" ");
  return cloneElement(children,{style:{...original,...(values.opacity!==undefined?{opacity:values.opacity}:{}),...(transforms?{transform:transforms}:{})}});
}
