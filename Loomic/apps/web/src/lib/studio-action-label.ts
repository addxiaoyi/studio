import type { VideoEditorAction } from "@helstera/shared";
import type { StudioSnapshot } from "./visualforge-runtime";
export function studioActionLabel(action:VideoEditorAction,snapshot:StudioSnapshot|undefined,english=false):string {
  if(action.type==="layer"){
    const name=snapshot?.layers?.find(layer=>layer.id===action.layerId)?.label??action.layerId;
    const labels:Record<string,string>=english?{text:"Text",fontSize:"Font size",color:"Color",x:"X",y:"Y",opacity:"Opacity",volume:"Volume",startMs:"Start (ms)",endMs:"End (ms)",removed:"Delete"}:{text:"文字",fontSize:"字号",color:"颜色",x:"横向位置",y:"纵向位置",opacity:"不透明度",volume:"音量",startMs:"开始(毫秒)",endMs:"结束(毫秒)",removed:"删除"};
    return `${name} · ${Object.entries(action.changes).map(([key,value])=>key==="removed"?labels[key]:`${labels[key]}：${value}`).join("；")}`;
  }
  if(action.type==="resize")return `${english?"Canvas":"画幅"} ${action.width} × ${action.height}`;
  if(action.type==="caption")return `${english?"Caption":"字幕"} ${action.startMs/1000}–${action.endMs/1000}s：${action.text}`;
  if(action.type==="audio")return `${english?"Music":"配乐"} ${action.assetName} · ${action.startMs/1000}s · ${Math.round(action.volume*100)}%`;
  if(action.type==="cut")return `${english?"Replace visuals":"替换画面"}：${action.clips.map(clip=>`${clip.name} ${clip.start}–${clip.end}s`).join("；")}`;
  return english?"Prepare export (confirm output settings separately)":"准备导出（另行确认输出设置）";
}
