import type {VirtualProject} from "../../vendor/visualforge/packages/browser-studio/src/types";
import type {MotionTrack} from "../../packages/shared/src/video-motion";
import {validateMotion} from "../../packages/shared/src/video-motion";
import {layerNodes} from "./native-layers";
declare const __LOOMIC_MOTION_FILES__:Record<string,string>;

export function motionFiles(){return __LOOMIC_MOTION_FILES__;}
export function animateLayers(project:VirtualProject,file:string,id:string,fps:number,duration:number,commands:{layerId:string;tracks:MotionTrack[]}[]){
  if(!commands.length)return project;
  const layers=layerNodes(project,file,id,fps,duration),files={...project.files};
  const edits=new Map<string,{start:number;end:number;source:string}[]>();
  for(const command of commands){
    const target=layers.find(entry=>entry.layer.id===command.layerId);
    if(!target?.layer.canAnimate)throw new Error("此图层无法安全添加动画。");
    validateMotion(command.tracks,target.layer.startMs,target.layer.endMs);
    const node=target.motionWrapper??target.node;
    if(node.start==null||node.end==null||target.node.start==null||target.node.end==null)throw new Error("图层动画位置不可用。");
    const child=project.files[target.file]!.slice(target.node.start,target.node.end);
    const replacement=command.tracks.length?`<LoomicMotion tracksJson={${JSON.stringify(JSON.stringify(command.tracks))}} offsetMs={${target.offset/fps*1000}}>${child}</LoomicMotion>`:child;
    const patches=edits.get(target.file)??[];patches.push({start:node.start,end:node.end,source:replacement});edits.set(target.file,patches);
  }
  for(const [path,patches] of edits){
    let boundary=Infinity;for(const patch of patches.sort((a,b)=>b.start-a.start)){
      if(patch.end>boundary)throw new Error("父子图层动画请分开确认。");files[path]=files[path]!.slice(0,patch.start)+patch.source+files[path]!.slice(patch.end);boundary=patch.start;
    }
    if(!files[path]!.includes('import {LoomicMotion}'))files[path]=`import {LoomicMotion} from "/project/src/loomic-motion";\n${files[path]}`;
  }
  return {...project,files:{...files,...motionFiles()}};
}
