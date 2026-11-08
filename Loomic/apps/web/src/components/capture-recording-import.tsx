"use client";
import { useEffect,useState } from "react";
import type { StudioRuntime } from "@/lib/visualforge-runtime";
import { fetchWebsiteCapture } from "@/lib/server-api";
import { readStudioAsset } from "@/lib/studio-media";
import { Button } from "@/components/ui/button";
const imports=new WeakMap<StudioRuntime,Map<string,Promise<string>>>();
export async function importCaptureRecording(runtime:StudioRuntime,token:string,taskId:string){
  let pending=imports.get(runtime);if(!pending){pending=new Map();imports.set(runtime,pending);}
  const prior=pending.get(taskId);if(prior)return prior;
  const work=(async()=>{
    const {task}=await fetchWebsiteCapture(token,taskId),assetId=task.result?.recordingAssetId;
    if(task.status!=='succeeded'||!assetId)throw new Error('录像尚未完成或已失效，请回到浏览任务核对。');
    const local=await runtime.readAsset(assetId);
    if(!local){const file=await readStudioAsset(token,assetId);if(file.type!=='video/webm'&&file.type!=='video/mp4')throw new Error('任务结果不是可剪辑的视频。');await runtime.importAsset(file,assetId);}
    if(!await runtime.readAsset(assetId))throw new Error('录像导入未完成，请重试。');return task.result?.title??'网站体验录像';
  })();pending.set(taskId,work);
  void work.catch(()=>pending!.delete(taskId));return work;
}
export function CaptureRecordingImport({runtime,token,userId,onImported}:{runtime:StudioRuntime|null;token:string;userId:string;onImported:()=>void}){
  const [taskId,setTaskId]=useState(''),[revision,setRevision]=useState(0),[state,setState]=useState(''),[error,setError]=useState('');
  useEffect(()=>{const id=new URL(window.location.href).searchParams.get('capture');if(id&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)){localStorage.setItem(`loomic:capture-import:${userId}`,id);setTaskId(id);}else setTaskId(localStorage.getItem(`loomic:capture-import:${userId}`)??'');},[userId]);
  useEffect(()=>{
    if(!runtime||!taskId)return;let active=true;setError('');setState('正在把网站录像导入工程…');
    void importCaptureRecording(runtime,token,taskId).then(title=>{if(!active)return;setState(`已导入：${title}。可以在 AI 对话中继续剪辑，或从素材列表拖入时间线。`);localStorage.removeItem(`loomic:capture-import:${userId}`);onImported();}).catch(cause=>{if(active){setState('');setError(cause instanceof Error?cause.message:'录像导入失败，请重试。');}});
    return()=>{active=false;};
  },[runtime,token,taskId,userId,revision,onImported]);
  if(!taskId)return null;
  return <div className="flex flex-wrap items-center gap-3 border-b bg-muted/20 px-4 py-3 text-sm" aria-label="网站录像导入"><p className="min-w-0 flex-1" role={error?'alert':'status'}>{error||state||'正在等待编辑器就绪…'}</p>{error?<Button size="sm" variant="outline" onClick={()=>setRevision(n=>n+1)}>重试导入</Button>:state.startsWith('已导入')&&<Button size="sm" variant="outline" onClick={()=>window.dispatchEvent(new CustomEvent('loomic:video-draft',{detail:'为刚导入的网站录像准备简短中文介绍配音，先给出完整文稿供确认；随后再添加对应字幕和淡入淡出转场，逐项确认。'}))}>用对话添加字幕、配音和转场</Button>}</div>;
}
