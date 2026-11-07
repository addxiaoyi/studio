"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {fetchGeneratedAssets,type GeneratedAsset} from "@/lib/server-api";
import {readStudioAsset} from "@/lib/studio-media";
import type {StudioRuntime} from "@/lib/visualforge-runtime";
import {useLocale} from "@/lib/i18n";
import {Button} from "./ui/button";

export function StudioMaterialLibrary({token,runtime,compositionId,query,mediaType,onImported}:{token:string;runtime:StudioRuntime|null;compositionId:string;query:string;mediaType?:"image"|"video"|undefined;onImported(name:string):Promise<void>}){
  const english=useLocale()==="en-US";
  const [search,setSearch]=useState(query),[page,setPage]=useState(1),[assets,setAssets]=useState<GeneratedAsset[]>([]),[more,setMore]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[imported,setImported]=useState<string[]>([]);
  const revision=useRef(0);
  const load=useCallback(async()=>{const version=++revision.current;setBusy(true);setError("");try{const reply=await fetchGeneratedAssets(token,{query:search,page,pageSize:6,...(mediaType?{mediaType}:{})});if(version!==revision.current)return;setAssets(reply.assets.filter(asset=>!asset.retentionState||asset.retentionState==="active"));setMore(reply.pagination.hasMore);}catch(cause){if(version===revision.current)setError(cause instanceof Error?cause.message:"素材库加载失败");}finally{if(version===revision.current)setBusy(false);}},[token,search,page,mediaType]);
  useEffect(()=>{const timer=setTimeout(()=>void load(),200);return()=>{clearTimeout(timer);revision.current++;};},[load]);
  async function importSelected(asset:GeneratedAsset){
    if(!runtime||busy)return;setBusy(true);setError("");
    try{
      if(runtime.projectId()!==compositionId)throw new Error("请先切回此对话对应的视频。");
      if(!asset.assetObjectId)throw new Error("素材尚未保存完整文件，请稍后重试。");
      const file=await runtime.readAsset(asset.id)??await readStudioAsset(token,asset.assetObjectId);
      if(runtime.projectId()!==compositionId)throw new Error("下载期间视频已切换，请重新导入。");
      await runtime.importAsset(file,asset.id);
      const entry=runtime.listMedia().find(item=>item.name.startsWith(`generated-${asset.id}-`));
      if(!entry)throw new Error("文件已导入，但编辑器尚未登记，请刷新核对。");
      setImported(current=>[...new Set([...current,asset.id])]);await onImported(entry.name);
    }catch(cause){setError(cause instanceof Error?cause.message:"素材导入失败");}finally{setBusy(false);}
  }
  return <section aria-label={english?"Private material library":"对话素材库"} className="space-y-3 rounded-xl border bg-background p-3">
    <h3 className="text-sm font-medium">{english?"Choose a private asset":"选择私有素材"}</h3>
    <label className="block text-xs">{english?"Search":"搜索素材"}<input aria-label={english?"Search materials":"搜索素材"} value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} className="mt-1 w-full rounded border bg-background p-2 text-base sm:text-sm"/></label>
    {busy&&<p role="status" className="text-xs">{english?"Loading…":"正在读取素材…"}</p>}
    {!busy&&!assets.length&&!error&&<p className="text-xs text-muted-foreground">{english?"No matching assets. Import a local file or ask AI to prepare a video generation request.":"暂无匹配素材。可以导入本机文件，或在对话中描述要生成的镜头。"}</p>}
    <ul className="space-y-2">{assets.map(asset=><li key={asset.id} className="flex items-center gap-2 border-t pt-2"><div className="min-w-0 flex-1"><p className="truncate text-xs">{asset.title||asset.prompt||asset.id}</p><p className="text-[11px] text-muted-foreground">{asset.mediaType==="video"?english?"Video":"视频":english?"Image":"图片"}</p></div><Button size="sm" variant="outline" disabled={busy||!runtime||!asset.assetObjectId||imported.includes(asset.id)} onClick={()=>void importSelected(asset)}>{imported.includes(asset.id)?english?"Imported":"已导入":english?"Import":"导入工程"}</Button></li>)}</ul>
    {(page>1||more)&&<div className="flex gap-2"><Button size="sm" variant="ghost" disabled={busy||page===1} onClick={()=>setPage(page-1)}>{english?"Previous":"上一页"}</Button><Button size="sm" variant="ghost" disabled={busy||!more} onClick={()=>setPage(page+1)}>{english?"Next":"下一页"}</Button></div>}
    {error&&<div role="alert" className="text-xs text-destructive">{error}<button onClick={()=>void load()} className="ml-2 underline">{english?"Retry":"重试"}</button></div>}
  </section>;
}
