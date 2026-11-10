"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {ProjectVideoDocument,ProjectVideoRevision} from "@helstera/shared";
import type {StudioRuntime} from "@/lib/visualforge-runtime";
import {fetchProjectVideo,fetchProjectVideoVersions,type ProjectVideoVersion} from "@/lib/project-video-api";
import {discardRejectedVideoSave,projectDocumentDiff,syncProjectVideo,videoSyncReceipt,type VideoSyncReceipt} from "@/lib/project-video-sync";
import {ProjectContextRequestError} from "@/lib/project-context-api";
import {useLocale} from "@/lib/i18n";

export function useProjectVideoSync(input:{token:string;projectId:string;projectKey:string;runtime:StudioRuntime|null}) {
  const english=useLocale()==="en-US";
  const [cloud,setCloud]=useState<ProjectVideoRevision|null>(null),[versions,setVersions]=useState<ProjectVideoVersion[]>([]);
  const [receipt,setReceipt]=useState<VideoSyncReceipt>({revision:0,hash:null});
  const [local,setLocal]=useState<ProjectVideoDocument|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const lock=useRef(false),alive=useRef(true);
  const [loaded,setLoaded]=useState(false),[confirmation,setConfirmation]=useState(false);
  const refresh=useCallback(async()=>{
    const [latest,history,saved]=await Promise.all([fetchProjectVideo(input.token,input.projectId),fetchProjectVideoVersions(input.token,input.projectId),videoSyncReceipt(input.projectKey)]);
    if(!alive.current)return;
    setCloud(latest);setVersions(history);setReceipt(saved);setLoaded(true);setConfirmation(false);
  },[input.token,input.projectId,input.projectKey]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const run=async(action:()=>Promise<void>)=>{
    if(lock.current)return;
    lock.current=true;setBusy(true);setError("");setNotice("");
    try{await action();}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"工程同步失败，本机内容仍保留。");}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  };
  const load=()=>run(refresh);
  const inspect=()=>run(async()=>{
    const document=await input.runtime?.portableProject?.();
    if(!document)throw new Error("请等待当前视频工程就绪后再同步。");
    await refresh();if(!alive.current)return;setLocal(document);setConfirmation(true);
  });
  const save=(retryPending=false)=>run(async()=>{
    if(!local && !retryPending)throw new Error("请先预览同步内容。");
    if(!retryPending && !confirmation)throw new Error("工程版本已变化，请重新比较后确认。");
    try {
      const saved=await syncProjectVideo({...input,document:local ?? receipt.pending!.document,expectedRevision:cloud?.revision??0,retryPending});
      if(!alive.current)return;setCloud(saved);setReceipt(await videoSyncReceipt(input.projectKey));setConfirmation(false);setNotice(english?`Project metadata saved as version ${saved.revision}. Original media remains local.`:`工程描述已保存为版本 ${saved.revision}，媒体原文件仍留在本机。`);setVersions(await fetchProjectVideoVersions(input.token,input.projectId));
    }catch(cause){
      if(cause instanceof ProjectContextRequestError && cause.status>=400 && cause.status<500 && cause.status!==408 && cause.status!==429){await discardRejectedVideoSave(input.projectKey);await refresh();}
      else if(alive.current)setReceipt(await videoSyncReceipt(input.projectKey));
      throw cause;
    }
  });
  const version=(revision:number)=>run(async()=>{const selected=await fetchProjectVideo(input.token,input.projectId,revision);if(!selected)throw new Error("该版本已不在保留范围，请刷新列表。");if(alive.current){setCloud(selected);setLocal(await input.runtime?.portableProject?.()??null);setConfirmation(false);}});
  return {cloud,versions,receipt,local,busy,error,notice,loaded,confirmation,diff:cloud?projectDocumentDiff(local,cloud.document):null,load,inspect,save,version};
}
