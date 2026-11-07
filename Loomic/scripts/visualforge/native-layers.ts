import { parse } from "../../vendor/visualforge/packages/codemods/node_modules/@babel/parser";
import type { JSXElement, Node } from "../../vendor/visualforge/packages/codemods/node_modules/@babel/types";
import { resolveCompositionComponentInProject } from "../../vendor/visualforge/packages/codemods/src/resolve-composition-component-location";
import type { VirtualProject } from "../../vendor/visualforge/packages/browser-studio/src/types";
import type { VideoEditorLayer, VideoLayerChanges } from "../../packages/shared/src/video-editor-context";

type LayerNode = { layer: VideoEditorLayer; node: JSXElement; file: string; offset: number; fps: number; motionWrapper?:JSXElement };
type SourceEdit = { start: number; end: number; source: string };
const visualTags = new Set(["div","span","p","h1","h2","h3","AbsoluteFill","Solid","Text","CanvasImage","Img","Video","Audio"]);
const styleKeys = { fontSize:"fontSize",color:"color",x:"left",y:"top",opacity:"opacity" } as const;

function prop(node: JSXElement, name: string) {
  return node.openingElement.attributes.find(item=>item.type==="JSXAttribute"&&item.name.name===name);
}
function value(node: JSXElement, name: string) {
  const attr=prop(node,name);if(attr?.type!=="JSXAttribute")return undefined;
  return attr.value?.type==="JSXExpressionContainer"?attr.value.expression:attr.value;
}
function scalar(node: JSXElement, name: string): string|number|undefined {
  const expression=value(node,name);return expression?.type==="StringLiteral"||expression?.type==="NumericLiteral"?expression.value:undefined;
}
function captionText(node: JSXElement) {
  const textProp=scalar(node,"text");if(typeof textProp==="string")return textProp;
  if(!node.children.length)return undefined;
  if(node.children.some(child=>child.type!=="JSXText"&&!(child.type==="JSXExpressionContainer"&&child.expression.type==="StringLiteral")))return undefined;
  return node.children.map(child=>child.type==="JSXText"?child.value:child.type==="JSXExpressionContainer"&&child.expression.type==="StringLiteral"?child.expression.value:"").join("").trim().slice(0,500);
}

export function layerNodes(project: VirtualProject, compositionFile: string, compositionId: string, fps: number, duration: number): LayerNode[] {
  const root=resolveCompositionComponentInProject({project,compositionFile,compositionId});
  const layers:LayerNode[]=[];
  const walk=(node:Node,file:string,offset:number,limit:number,ancestry:Set<string>,inheritedTiming=false)=>{
    if(layers.length>=200)throw new Error("图层超过200个，请简化当前合成后使用AI编辑。");
    if(node.type==="JSXFragment"){node.children.forEach(child=>walk(child,file,offset,limit,ancestry,inheritedTiming));return;}
    if(node.type!=="JSXElement"||node.openingElement.name.type!=="JSXIdentifier")return;
    const tag=node.openingElement.name.name;
    if(tag==="LoomicMotion"){
      const start=layers.length;
      node.children.forEach(child=>walk(child,file,offset,limit,ancestry,inheritedTiming));
      const target=layers[start];
      if(target){target.motionWrapper=node;const serialized=scalar(node,"tracksJson");if(typeof serialized==="string")target.layer.motion=JSON.parse(serialized);}
      return;
    }
    const ast=parse(project.files[file]!,{sourceType:"module",plugins:["jsx","typescript"]});
    const imported=ast.program.body.find(item=>item.type==="ImportDeclaration"&&item.specifiers.some(specifier=>specifier.local.name===tag));
    if(imported?.type==="ImportDeclaration"&&/basic-captions\.element$/.test(imported.source.value))return;
    if(/^[A-Z]/.test(tag)&&tag!=="Sequence"&&(!imported||imported.type==="ImportDeclaration"&&imported.source.value.startsWith("."))) {
      const key=`${file}:${tag}`;if(ancestry.has(key)||ancestry.size>24)throw new Error("图层组件循环引用，无法读取。");
      const inspectionId="__loomic_layer_inspection__";
      const child=resolveCompositionComponentInProject({project:{...project,files:{...project.files,[file]:`${project.files[file]}\nconst __loomicLayer=<Composition id="${inspectionId}" component={${tag}} />;`}},compositionFile:file,compositionId:inspectionId});
      walk(child.root,child.filePath,offset,limit,new Set([...ancestry,key]),inheritedTiming);return;
    }
    const sequence=tag==="Sequence";
    const from=offset+(sequence?Number(scalar(node,"from")??0):0);
    const length=sequence?scalar(node,"durationInFrames"):undefined;
    const end=typeof length==="number"?Math.min(limit,from+length):limit;
    const dynamicTiming=inheritedTiming||sequence&&((value(node,"from")!==undefined&&typeof scalar(node,"from")!=="number")||(value(node,"durationInFrames")!==undefined&&typeof length!=="number"));
    const editable:VideoEditorLayer["editable"]=[];
    const text=captionText(node);
    const values:NonNullable<VideoEditorLayer["values"]>={...(text===undefined?{}:{text})};
    if(!dynamicTiming&&end>from&&(visualTags.has(tag)||sequence)){
      editable.push("removed");
      if(sequence)editable.push("startMs","endMs");
      if(text!==undefined)editable.push("text");
      if(tag==="Audio"&&(value(node,"volume")===undefined||typeof scalar(node,"volume")==="number"))editable.push("volume");
      const style=value(node,"style");
      if(visualTags.has(tag)&&tag!=="Audio"&&(!style||style.type==="ObjectExpression"&&style.properties.every(item=>item.type==="ObjectProperty"&&!item.computed)))editable.push("fontSize","color","x","y","opacity");
      for(const [key,css] of Object.entries(styleKeys)){
        const property=style?.type==="ObjectExpression"?style.properties.find(item=>item.type==="ObjectProperty"&&!item.computed&&(item.key.type==="Identifier"?item.key.name:item.key.type==="StringLiteral"?item.key.value:"")===css):undefined;
        if(property?.type==="ObjectProperty"){
          const expression=property.value;
          if(expression.type==="NumericLiteral"||expression.type==="StringLiteral")Object.assign(values,{[key]:expression.value});
        }
      }
      const volume=scalar(node,"volume");if(typeof volume==="number")values.volume=volume;
    }
    if(visualTags.has(tag)||sequence)layers.push({node,file,offset,fps,layer:{id:`layer-${layers.length}`,label:String(scalar(node,"name")??text??tag).slice(0,240),kind:tag,...(text===undefined?{}:{text}),startMs:Math.round(Math.max(0,from)/fps*1000),endMs:Math.round(Math.max(from+1,end)/fps*1000),editable,canAnimate:!dynamicTiming&&!sequence&&tag!=="Audio",...(Object.keys(values).length?{values}:{})}});
    node.children.forEach(child=>walk(child,file,from,end,ancestry,dynamicTiming));
  };
  walk(root.root,root.filePath,0,Math.round(duration*fps),new Set());
  // A source node rendered more than once cannot be edited as an isolated occurrence.
  for(const entry of layers)if(layers.filter(other=>other.file===entry.file&&other.node.start===entry.node.start).length>1){entry.layer.editable=[];entry.layer.canAnimate=false;}
  return layers;
}

export function inspectLayers(project:VirtualProject,file:string,id:string,fps:number,duration:number) {
  return layerNodes(project,file,id,fps,duration).map(entry=>entry.layer);
}

export function changeLayers(project:VirtualProject,file:string,id:string,fps:number,duration:number,changes: {layerId:string;changes:VideoLayerChanges}[]):VirtualProject {
  if(!changes.length)return project;
  const layers=layerNodes(project,file,id,fps,duration);
  const edits=new Map<string,SourceEdit[]>();
  for(const command of changes){
    const target=layers.find(item=>item.layer.id===command.layerId);
    if(!target||Object.keys(command.changes).some(key=>!target.layer.editable.includes(key as keyof VideoLayerChanges)))throw new Error("图层或可编辑属性已改变，请重新预览。");
    const {node,layer}=target, source=project.files[target.file]!;
    const patches=edits.get(target.file)??[];edits.set(target.file,patches);
    const patch=(start:number|null|undefined,end:number|null|undefined,text:string)=>{if(start==null||end==null)throw new Error("图层位置不可用。");patches.push({start,end,source:text});};
    const attributes:Record<string,string>={};
    const update=command.changes;
    if(update.removed){const removed=target.motionWrapper??node;patch(removed.start,removed.end,"<></>");continue;}
    if(update.text!==undefined){
      if(typeof scalar(node,"text")==="string")attributes.text=JSON.stringify(update.text);
      else if(node.closingElement)patch(node.openingElement.end,node.closingElement.start,`{${JSON.stringify(update.text)}}`);
      else throw new Error("这个图层没有可替换的文本。");
    }
    if(update.volume!==undefined)attributes.volume=String(update.volume);
    if(update.startMs!==undefined||update.endMs!==undefined){
      const start=update.startMs??layer.startMs,end=update.endMs??layer.endMs;
      if(start<target.offset/fps*1000||end<=start||end>duration*1000)throw new Error("图层时间超出父级或视频范围。");
      attributes.from=String(Math.round(start/1000*fps)-target.offset);
      attributes.durationInFrames=String(Math.max(1,Math.round((end-start)/1000*fps)));
    }
    const styles=Object.entries(styleKeys).filter(([key])=>update[key as keyof VideoLayerChanges]!==undefined);
    if(styles.length){
      const overridden=new Set<string>(styles.map(([,key])=>key));
      if(update.x!==undefined)overridden.add("right");if(update.y!==undefined)overridden.add("bottom");
      const style=value(node,"style");
      if(update.x!==undefined||update.y!==undefined)overridden.add("position");
      const properties=style?.type==="ObjectExpression"?style.properties.filter(item=>item.type==="ObjectProperty"&&!overridden.has(item.key.type==="Identifier"?item.key.name:item.key.type==="StringLiteral"?item.key.value:"")).map(item=>source.slice(item.start!,item.end!)):[];
      properties.push(...styles.map(([key,css])=>`${css}:${JSON.stringify(update[key as keyof VideoLayerChanges])}`));
      if(update.x!==undefined||update.y!==undefined)properties.push('position:"absolute"');
      attributes.style=`{${properties.join(",")}}`;
    }
    const additions:string[]=[];
    for(const [name,expression] of Object.entries(attributes)){
      const attribute=prop(node,name),replacement=`${name}={${expression}}`;
      if(attribute)patch(attribute.start,attribute.end,replacement);else additions.push(replacement);
    }
    if(additions.length)patch(node.openingElement.name.end,node.openingElement.name.end," "+additions.join(" "));
  }
  const files={...project.files};
  for(const [path,patches] of edits){
    patches.sort((a,b)=>b.start-a.start);
    let boundary=Infinity;
    for(const patch of patches){if(patch.end>boundary)throw new Error("图层修改存在包含关系，请分两次确认。");files[path]=files[path]!.slice(0,patch.start)+patch.source+files[path]!.slice(patch.end);boundary=patch.start;}
  }
  return {...project,files};
}
