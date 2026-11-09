import type { VideoStudioControl, VideoStudioState } from "../../packages/shared/src/video-editor-context";

type StudioTool = { name:string; execute(args:Record<string,unknown>):unknown };
type ModelContext = { registerTool(tool:StudioTool,options?:{signal?:AbortSignal}):Promise<unknown> };
const allowed=new Set(["get_composition","get_compositions","get_playback_state","get_selection","play","pause","mute","unmute","seek_to_frame","select_composition"]);
declare global {interface Window {loomicControlTools?:Map<string,StudioTool>}}
const toolRegistry=()=>window.loomicControlTools??=new Map<string,StudioTool>();

export function studioModelContext(external?: ModelContext):ModelContext {
  return { async registerTool(tool,options) {
    if(allowed.has(tool.name)){
      const registered=toolRegistry();
      registered.set(tool.name,tool);
      options?.signal?.addEventListener("abort",()=>{if(registered.get(tool.name)===tool)registered.delete(tool.name);},{once:true});
    }
    return external?.registerTool(tool,options);
  } };
}
async function invoke<T>(name:string,args:Record<string,unknown>={}):Promise<T> {
  const tool=toolRegistry().get(name);if(!tool)throw new Error("预览控制尚未就绪，请稍后重试。");
  return await tool.execute(args) as T;
}
export async function waitForStudioComposition(id: string, signal: AbortSignal) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const tool = toolRegistry().get("get_composition");
    const selected = tool ? await tool.execute({}) as { compositionName: string | null } : null;
    const render = [...document.querySelectorAll<HTMLButtonElement>('#render-modal-button-client')].some(button => button.dataset.compositionId === id);
    if (selected?.compositionName === id && render) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("时间线已保存，但编辑器仍未切换到新合成。请等待编译完成后重试，避免导出其他视频。");
}
function compositionNames(tree:unknown):string[]{
  if(Array.isArray(tree))return tree.flatMap(compositionNames);
  if(!tree||typeof tree!=="object")return [];
  const item=tree as Record<string,unknown>;
  return [...(item.type==="composition"&&typeof item.compositionName==="string"?[item.compositionName]:[]),...Object.values(item).flatMap(child=>typeof child==="object"?compositionNames(child):[])];
}
export async function readStudioState():Promise<VideoStudioState> {
  const [composition,playback,tree,selection]=await Promise.all([
    invoke<{compositionName:string;fps:number}>("get_composition"),
    invoke<{currentFrame:number;playing:boolean;muted:boolean}>("get_playback_state"),
    invoke<{compositions:unknown}>("get_compositions"),invoke<unknown>("get_selection"),
  ]);
  return {compositions:[...new Set([composition.compositionName,...compositionNames(tree.compositions)])].filter(Boolean).slice(0,200),fps:composition.fps,currentFrame:playback.currentFrame,playing:playback.playing,muted:playback.muted,selection:JSON.stringify(selection).slice(0,2000),controls:["play","pause","seek","mute","select","export","panel"],undoable:[]};
}
export async function controlStudio(control:VideoStudioControl,compositionId:string):Promise<string> {
  const state=await invoke<{compositionName:string;fps:number;durationInFrames:number}>("get_composition");
  if(state.compositionName!==compositionId)throw new Error("当前视频已切换，请重新发送操作要求。");
  if(control.type==="seek"){
    const frame=Math.round(control.seconds*state.fps);if(frame>=state.durationInFrames)throw new Error("播放位置超出视频时长。");
    await invoke("seek_to_frame",{frame});return `已定位到 ${control.seconds} 秒。`;
  }
  if(control.type==="select"){await invoke("select_composition",{compositionName:control.compositionId});return `已切换到 ${control.compositionId}。`;}
  if(control.type==="mute"){await invoke(control.muted?"mute":"unmute");return control.muted?"预览已静音，导出音轨不变。":"预览已恢复声音。";}
  if(control.type==="play"||control.type==="pause"){await invoke(control.type);return control.type==="play"?"正在播放当前视频。":"预览已暂停。";}
  throw new Error("该操作需要工作区确认后执行。");
}
