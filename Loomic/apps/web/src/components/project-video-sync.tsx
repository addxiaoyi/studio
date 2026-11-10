"use client";
import {useEffect,useRef,useState,type ChangeEvent} from "react";
import type {ProjectVideoRevision} from "@helstera/shared";
import type {StudioRuntime} from "@/lib/visualforge-runtime";
import {useProjectVideoSync} from "@/hooks/use-project-video-sync";
import {projectDocumentHash} from "@/lib/project-video-sync";
import {readStudioAsset,MAX_STUDIO_MEDIA_BYTES} from "@/lib/studio-media";
import {Button} from "./ui/button";
import {StyledSelect} from "./ui/styled-select";
import {useLocale} from "@/lib/i18n";
import {listStudioRecoveryKeys} from "@/lib/visualforge-storage";

type Props={token:string;projectId:string;projectKey:string;runtime:StudioRuntime|null;disabled:boolean;
  restore(revision:ProjectVideoRevision,files:Record<string,File>,expectedLocalHash:string|null):Promise<void>;
  recoverLocal(backupKey:string,expectedLocalHash:string|null):Promise<void>};

export function ProjectVideoSync(props:Props) {
  const en=useLocale()==="en-US",text=(zh:string,english:string)=>en?english:zh;
  const date=(value:string|number)=>new Date(value).toLocaleString(en?"en-US":"zh-CN");
  const sync=useProjectVideoSync(props),[files,setFiles]=useState<Record<string,File>>({}),[mediaError,setMediaError]=useState(""),[restoring,setRestoring]=useState(false),[downloading,setDownloading]=useState(false),[consent,setConsent]=useState(false);
  const transfer=useRef<AbortController|null>(null);
  const [recoveryKeys,setRecoveryKeys]=useState<string[]>([]),[recoveryKey,setRecoveryKey]=useState(""),[localConsent,setLocalConsent]=useState(false);
  useEffect(()=>()=>transfer.current?.abort(),[]);
  useEffect(()=>{setFiles({});setConsent(false);setMediaError("");},[sync.cloud?.revision]);
  const loadRecovery=async()=>{try{setRecoveryKeys((await listStudioRecoveryKeys(props.projectKey)).filter((key):key is string=>typeof key==="string").sort().reverse());}catch(cause){setMediaError(cause instanceof Error?cause.message:"无法读取恢复副本。");}};
  const busy=sync.busy||restoring||downloading||props.disabled;
  const selectVersion=(value:string)=>{void sync.version(Number(value));};
  const chooseFile=(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0],name=event.target.dataset.asset;
    if(!file||!name)return;
    const reference=sync.cloud?.document.assets.find(asset=>asset.name===name);
    if(!reference||file.size!==reference.size){setMediaError(text("文件大小不匹配，请选择原始素材。","File size differs. Select the original media."));return;}
    setMediaError("");setFiles(current=>({...current,[name]:file}));setConsent(false);
  };
  const download=async()=>{
    if(busy||!sync.cloud)return;
    const controller=new AbortController();transfer.current=controller;setDownloading(true);setMediaError("");
    try{
      for(const asset of sync.cloud.document.assets){
        if(files[asset.name]||!asset.assetId)continue;
        if(asset.size>MAX_STUDIO_MEDIA_BYTES)throw new Error(text("大素材请从本机选择原文件；此处单次取回上限为 250 MiB。","Select larger media locally. Individual cloud downloads are limited to 250 MiB here."));
        const file=await readStudioAsset(props.token,asset.assetId,controller.signal);
        if(file.size!==asset.size)throw new Error(text(`云端素材大小已变化：${asset.name}`,`Cloud media changed: ${asset.name}`));
        setFiles(current=>({...current,[asset.name]:new File([file],asset.name,{type:asset.mimeType})}));
      }
    }catch(cause){if(!controller.signal.aborted)setMediaError(cause instanceof Error?cause.message:"素材取回失败。");}
    finally{setDownloading(false);transfer.current=null;}
  };
  const restore=async()=>{
    if(busy||!sync.cloud||!consent)return;
    setRestoring(true);setMediaError("");
    try{const local=await props.runtime?.portableProject?.();await props.restore(sync.cloud,files,local?await projectDocumentHash(local):null);await loadRecovery();setConsent(false);}
    catch(cause){setMediaError(cause instanceof Error?cause.message:text("工程恢复失败，原文件仍保留。","Could not restore. Original files are preserved."));}
    finally{setRestoring(false);}
  };
  const missing=sync.cloud?.document.assets.filter(asset=>!files[asset.name])??[];
  const recoverLocal=async()=>{
    if(busy||!localConsent||!recoveryKey)return;
    setRestoring(true);setMediaError("");
    try{const local=await props.runtime?.portableProject?.();await props.recoverLocal(recoveryKey,local?await projectDocumentHash(local):null);await loadRecovery();setLocalConsent(false);}
    catch(cause){setMediaError(cause instanceof Error?cause.message:"恢复失败，当前工程仍保留。");}
    finally{setRestoring(false);}
  };
  return <details className="max-h-[65dvh] shrink-0 overflow-y-auto border-b px-4 py-3 text-sm sm:px-5" onToggle={event=>{if(event.currentTarget.open){void loadRecovery();if(!sync.loaded&&!sync.busy)void sync.load();}}}>
    <summary className="sticky top-0 z-10 cursor-pointer rounded bg-background py-1 font-medium focus-visible:ring-2 focus-visible:ring-ring">{text("工程同步与版本","Project sync and versions")}</summary>
    <div className="mt-3 max-w-3xl space-y-3">
      <p className="text-sm leading-6 text-muted-foreground">{text("按需保存剪辑源文件、编辑记录和素材引用。图片、音频和视频原文件留在本机；换设备时可取回已有云端素材或重新选择原文件。每次点击才同步，保留最近 20 个版本。","Save source files, edit history and media references on request. Original media stays local. Other devices can fetch existing private media or relink originals. Each save is explicit; the latest 20 versions are retained.")}</p>
      {sync.loaded && <p role="status">{sync.cloud?text(`云端版本 ${sync.cloud.revision} · ${date(sync.cloud.updatedAt)}`,`Cloud version ${sync.cloud.revision} · ${date(sync.cloud.updatedAt)}`):text("尚未同步，当前只保存在本机。","Not synced. This project is saved only on this device.")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy||!props.runtime} onClick={sync.inspect}>{text("预览当前版本同步内容","Review local version for sync")}</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={sync.load}>{text("刷新云端版本","Refresh cloud versions")}</Button>
        {sync.receipt.pending&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>void sync.save(true)}>{text("重试未确认的保存","Retry unconfirmed save")}</Button>}
      </div>
      {sync.confirmation&&sync.local&&<section aria-label={text("确认工程描述同步","Review project metadata sync")} className="space-y-2 rounded-lg border p-3">
        <p>{text(`将保存 ${Object.keys(sync.local.files).length} 个源文件、${sync.local.assets.length} 项素材引用，上传媒体原文件 0 字节。`,`Save ${Object.keys(sync.local.files).length} source files and ${sync.local.assets.length} media references. Original media uploaded: 0 bytes.`)}</p>
        {sync.cloud&&<p>{text(`云端当前为版本 ${sync.cloud.revision}。确认后创建新版本，历史版本保留。`,`Cloud version ${sync.cloud.revision} exists. Confirmation creates a new version and preserves history.`)}</p>}
        <Button size="sm" disabled={busy||Boolean(sync.receipt.pending)} onClick={()=>void sync.save()}>{text("确认同步工程描述","Confirm metadata sync")}</Button>
      </section>}
      {sync.versions.length>0&&<div className="max-w-sm"><StyledSelect aria-label={text("工程历史版本","Project version history")} value={String(sync.cloud?.revision??"")} options={sync.versions.map(row=>({value:String(row.revision),label:text(`版本 ${row.revision}`,`Version ${row.revision}`),note:date(row.updatedAt)}))} disabled={busy} onChange={selectVersion}/></div>}
      {sync.cloud&&<section aria-label={text("恢复工程版本","Restore project version")} className="space-y-3 rounded-lg border p-3">
        <p className="font-medium">{text(`恢复版本 ${sync.cloud.revision} 到本机`,`Restore version ${sync.cloud.revision} locally`)}</p>
        {sync.diff&&<details><summary className="cursor-pointer py-1">{text("查看源文件与素材差异","Compare source files and media")}</summary><ul className="mt-2 max-h-40 overflow-auto break-all text-xs">{[...sync.diff.added.map(name=>`+ ${name}`),...sync.diff.removed.map(name=>`− ${name}`),...sync.diff.changed.map(name=>`↔ ${name}`),...sync.diff.media.map(name=>`◇ ${name}`)].map(line=><li key={line}>{line}</li>)}</ul></details>}
        {sync.cloud.document.assets.length>0&&<>
          <Button size="sm" variant="outline" disabled={busy} onClick={()=>void download()}>{text("取回可用云端素材","Fetch available cloud media")}</Button>
          <ul className="max-h-64 space-y-3 overflow-auto">{sync.cloud.document.assets.map(asset=><li key={asset.name} className="space-y-1 break-all">
            <p className="text-xs">{asset.name} · {asset.size<104858?`${Math.ceil(asset.size/1024)} KiB`:`${(asset.size/1048576).toFixed(1)} MiB`}</p>
            <label className={`relative inline-flex min-h-9 cursor-pointer items-center rounded-md border bg-background px-3 text-sm focus-within:ring-2 focus-within:ring-ring ${busy?"opacity-50":"hover:bg-muted"}`}><span>{text("选择原文件","Choose original file")}</span><input type="file" data-asset={asset.name} aria-label={text(`关联素材 ${asset.name}`,`Relink ${asset.name}`)} onChange={chooseFile} disabled={busy} className="sr-only"/></label>
            <p className="text-xs text-muted-foreground">{files[asset.name]?text("已选择，恢复时校验。","Selected; verified during restore."):text("需要选择原文件或从云端取回。","Select the original or fetch it from the cloud.")}{!asset.sha256&&text(" 大文件仅核对大小，请确认选择的是原文件。"," Large files are matched by size only; confirm the original file.")}</p>
          </li>)}</ul>
        </>}
        <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={consent} disabled={busy||missing.length>0} onChange={event=>setConsent(event.target.checked)} className="mt-1.5"/>{text("我确认以上版本和素材。恢复前保留当前本机副本，云端版本不变。","I confirm this version and its media. Preserve a local recovery copy before restoring. The cloud version stays unchanged.")}</label>
        <Button size="sm" disabled={busy||!consent||missing.length>0} onClick={()=>void restore()}>{text("确认恢复到本机","Confirm local restore")}</Button>
      </section>}
      {recoveryKeys.length>0&&<section aria-label={text("本机恢复副本","Local recovery copies")} className="space-y-2 rounded-lg border p-3">
        <p className="font-medium">{text("本机恢复副本","Local recovery copies")}</p>
        <StyledSelect aria-label={text("选择本机恢复副本","Choose local recovery copy")} value={recoveryKey} placeholder={text("选择恢复前保留的副本","Choose a copy saved before restoring")} options={recoveryKeys.map(key=>({value:key,label:date(Number(key.slice(`${props.projectKey}:recovery:`.length).split(":")[0]))}))} onChange={key=>{setRecoveryKey(key);setLocalConsent(false);}} disabled={busy}/>
        <label className="flex items-start gap-2 leading-6"><input type="checkbox" checked={localConsent} disabled={busy||!recoveryKey} onChange={event=>setLocalConsent(event.target.checked)} className="mt-1.5"/>{text("保留当前版本后，恢复选中的本机副本。","Preserve the current version, then restore this local copy.")}</label>
        <Button size="sm" variant="outline" disabled={busy||!localConsent||!recoveryKey} onClick={()=>void recoverLocal()}>{text("恢复本机副本","Restore local copy")}</Button>
      </section>}
      {busy&&<p role="status">{text("正在处理工程…","Processing project…")}</p>}
      {sync.notice&&<p role="status" className="text-sm text-muted-foreground">{sync.notice}</p>}
      {(sync.error||mediaError)&&<p role="alert" className="break-words text-sm text-destructive">{sync.error||mediaError}</p>}
    </div>
  </details>;
}
