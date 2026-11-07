"use client";
import {useEffect,useRef,useState} from "react";
import type {VideoMaterialRequest} from "@helstera/shared";
import {fetchVideoModels,type VideoModelInfo} from "@/lib/server-api";
import {readStudioAsset} from "@/lib/studio-media";
import {useStudioVideoGeneration} from "@/hooks/use-studio-video-generation";
import type {StudioRuntime} from "@/lib/visualforge-runtime";
import {useLocale} from "@/lib/i18n";
import {Button} from "./ui/button";

export function StudioMaterialGeneration({request,userId,token,runtime,compositionId,onImported}:{request:Extract<VideoMaterialRequest,{type:"generate"}>;userId:string;token:string;runtime:StudioRuntime|null;compositionId:string;onImported(name:string):Promise<void>}){
  const english=useLocale()==="en-US",generation=useStudioVideoGeneration(userId,token);
  const [models,setModels]=useState<VideoModelInfo[]>([]),[model,setModel]=useState(""),[prompt,setPrompt]=useState(request.prompt),[duration,setDuration]=useState(request.duration??5),[resolution,setResolution]=useState("720p"),[ratio,setRatio]=useState(request.aspectRatio??"16:9");
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[preview,setPreview]=useState(""),[importing,setImporting]=useState(false),[imported,setImported]=useState("");
  const [catalogRevision,setCatalogRevision]=useState(0);
  const state=generation.state,lock=useRef(false);
  useEffect(()=>{let alive=true;setLoading(true);void fetchVideoModels().then(reply=>{if(alive){const available=reply.models.filter(item=>item.accessible!==false&&item.capabilities?.textToVideo!==false);setModels(available);setModel(current=>available.some(item=>item.id===current)?current:available[0]?.id||"");setError("");}}).catch(cause=>{if(alive)setError(cause.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[catalogRevision]);
  const selected=models.find(item=>item.id===model);
  const seconds=selected?.limits?.allowedDurations??[5,8,10].filter(value=>value<=(selected?.limits?.maxDuration??10));
  const resolutions=selected?.resolutionRates?.map(rate=>rate.resolution)??[selected?.limits?.maxResolution??"720p"];
  const selectedDuration=seconds.includes(duration)?duration:seconds[0]??5;
  const selectedResolution=resolutions.includes(resolution as never)?resolution:resolutions[0]??"720p";
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  async function importGenerated(){
    if(lock.current||!runtime||state?.phase!=="succeeded"||!state.assetId)return;lock.current=true;setImporting(true);setError("");
    try{
      if(runtime.projectId()!==compositionId)throw new Error("请切回此视频再导入生成素材。");
      const file=await runtime.readAsset(state.assetId)??await readStudioAsset(token,state.assetId);
      if(runtime.projectId()!==compositionId)throw new Error("视频已切换，生成素材保留在素材库。");
      await runtime.importAsset(file,state.assetId);setPreview(URL.createObjectURL(file));
      const entry=runtime.listMedia().find(item=>item.name.startsWith(`generated-${state.assetId}-`));if(!entry)throw new Error("编辑器未登记素材，请刷新核对。");
      setImported(state.assetId);await onImported(entry.name);
    }catch(cause){setError(cause instanceof Error?cause.message:"生成素材取回失败");}finally{lock.current=false;setImporting(false);}
  }
  const busy=generation.busy||importing;
  return <section aria-label={english?"Generate video material":"对话生成素材"} className="space-y-3 rounded-xl border bg-background p-3">
    <h3 className="text-sm font-medium">{english?"Generate a shot":"生成视频镜头"}</h3>
    {!state?<>
      <label className="block text-xs">{english?"Shot description":"镜头描述"}<textarea value={prompt} onChange={event=>setPrompt(event.target.value)} rows={3} className="mt-1 w-full rounded border bg-background p-2 text-base sm:text-sm"/></label>
      <label className="block text-xs">{english?"Model":"视频模型"}<select aria-label="视频模型" value={model} onChange={event=>setModel(event.target.value)} disabled={loading} className="mt-1 w-full rounded border bg-background p-2 text-base sm:text-sm">{!models.length&&<option>{loading?"加载模型…":"暂无可用模型"}</option>}{models.map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs">{english?"Seconds":"时长"}<select aria-label="生成时长" value={selectedDuration} onChange={event=>setDuration(Number(event.target.value))} className="mt-1 w-full rounded border bg-background p-2">{seconds.map(value=><option key={value}>{value}</option>)}</select></label><label className="text-xs">{english?"Resolution":"分辨率"}<select value={selectedResolution} onChange={event=>setResolution(event.target.value)} className="mt-1 w-full rounded border bg-background p-2">{resolutions.map(value=><option key={value}>{value}</option>)}</select></label></div>
      <label className="block text-xs">{english?"Aspect ratio":"画幅"}<select value={ratio} onChange={event=>setRatio(event.target.value as "16:9"|"9:16")} className="ml-2 rounded border bg-background p-2"><option>16:9</option><option>9:16</option></select></label>
      <p className="text-xs text-muted-foreground">{english?"Review the exact charge before this task starts.":"先查询本次精确费用，确认后才创建生成任务。"}</p>
      <Button className="w-full" disabled={busy||loading||!model||!prompt.trim()} onClick={()=>void generation.start({prompt,model,duration:selectedDuration,resolution:selectedResolution,aspectRatio:ratio,requireConfirmation:true})}>{english?"Review generation cost":"查看本次生成费用"}</Button>
    </>:<>
      <p className="text-xs leading-5">{state.request.draft.prompt}</p><p className="text-xs text-muted-foreground">{state.request.draft.model} · {state.request.draft.duration}s · {state.request.draft.resolution}</p>
      {state.phase==="approval"&&state.request.approval&&<div className="space-y-2"><p className="text-sm font-semibold">{state.request.approval.estimatedCredits} {english?"credits":"积分"}</p><div className="flex gap-2"><Button disabled={busy} onClick={generation.approve}>{english?"Confirm charge and generate":"确认费用并生成"}</Button><Button variant="outline" disabled={busy} onClick={generation.cancel}>{english?"Reject":"拒绝"}</Button></div></div>}
      {state.phase==="draft"&&<Button disabled={busy} onClick={generation.resume}>{english?"Recover original request":"恢复原请求"}</Button>}
      {state.phase==="running"&&<><p role="status" className="text-xs">{state.message}</p><Button disabled={busy} variant="outline" onClick={generation.cancel}>{english?"Cancel generation":"取消生成"}</Button></>}
      {state.phase==="succeeded"&&<><p className="text-xs">{english?"Saved to your private library.":"已生成并保存到私有素材库。"}</p><Button disabled={busy||imported===state.assetId} onClick={()=>void importGenerated()}>{imported===state.assetId?english?"Imported":"已导入工程":english?"Import result":"取回并导入工程"}</Button>{preview&&<video src={preview} controls className="max-h-48 w-full rounded"/>}</>}
      {["failed","canceled"].includes(state.phase)&&<p role="status" className="text-xs">{state.message}</p>}
      {["succeeded","failed","canceled"].includes(state.phase)&&<Button variant="ghost" disabled={busy} onClick={generation.reset}>{english?"Prepare another shot":"准备下一段素材"}</Button>}
    </>}
    {(error||generation.error)&&<div role="alert" className="space-y-2 text-xs text-destructive"><p>{error||generation.error}</p><Button size="sm" variant="outline" onClick={state?generation.refresh:()=>setCatalogRevision(value=>value+1)}>{state?english?"Refresh task":"重新查询任务":english?"Reload models":"重新加载模型"}</Button></div>}
  </section>;
}
