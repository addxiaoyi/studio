"use client";
import { useEffect,useState } from "react";
import type { StudioRuntime } from "@/lib/visualforge-runtime";
import { fetchWebsiteCapture } from "@/lib/server-api";
import { readStudioAsset } from "@/lib/studio-media";
import { Button } from "@/components/ui/button";
import { studioVideoDuration } from "@/lib/studio-video-metadata";
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
export async function importCanvasVideo(runtime: StudioRuntime, token: string, assetId: string) {
  const prior = await runtime.readAsset(assetId);
  if (prior) return prior;
  const file = await readStudioAsset(token, assetId);
  if (!file.type.startsWith("video/")) throw new Error("所选素材不是视频。");
  await runtime.importAsset(file, assetId);
  const restored = await runtime.readAsset(assetId);
  if (!restored) throw new Error("视频导入未保存，请重试。");
  return restored;
}

export function CanvasVideoImport({ runtime, token, onImported }: { runtime: StudioRuntime | null; token: string; onImported(): void }) {
  const [source, setSource] = useState<{ id: string; start: number; end?: number; returnCanvas: string; title: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [inTimeline, setInTimeline] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const query = new URL(window.location.href).searchParams;
    const id = query.get("assetId"), start = Number(query.get("start") ?? 0), end = query.has("end") ? Number(query.get("end")) : undefined;
    if (id && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) setSource({ id, start: Number.isFinite(start) && start >= 0 ? start : 0, ...(end !== undefined && Number.isFinite(end) && end > start ? { end } : {}), returnCanvas: query.get("returnCanvas") ?? "", title: query.get("title")?.slice(0,100) || "画布视频" });
  }, []);
  useEffect(() => {
    if (!runtime || !source) return;
    let alive = true;
    setError(""); setBusy(true);
    void importCanvasVideo(runtime, token, source.id).then(imported => {
      if (!alive) return;
      setFile(imported); onImported();
      setInTimeline(Boolean(runtime.readCut()?.clips.some(clip => clip.id === `canvas-${source.id}`)));
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "视频导入失败。"); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [runtime, source, token, revision, onImported]);
  async function addClip() {
    if (!runtime || !file || !source || busy) return;
    setBusy(true); setError("");
    try {
      const duration = await studioVideoDuration(file);
      const start = Math.min(source.start, duration - 1 / 30), end = Math.min(source.end ?? duration, duration);
      if (start < 0 || end - start < 1 / 30) throw new Error("画布裁剪范围超出视频时长，请重新选择。");
      if (runtime.projectId() === "current-project") {
        const selected = (await runtime.studioState()).compositions[0];
        if (!selected) throw new Error("请选择要加入片段的合成。");
        runtime.selectComposition(selected);
      }
      const cut = runtime.readCut();
      const clipId = `canvas-${source.id}`;
      if (!cut?.clips.some(clip => clip.id === clipId)) await runtime.applyCut({ ...(cut ?? { format: "landscape", clips: [] }), clips: [...(cut?.clips ?? []), { id: clipId, name: file.name, duration, start, end }] });
      const edited = await runtime.snapshot();
      if (edited.duration + 1 / 30 < (cut?.clips.reduce((total,clip) => total+clip.end-clip.start,0) ?? 0) + end - start) throw new Error("合成尚未更新为完整视频时长，请等待编辑器加载后重试。");
      setInTimeline(true); onImported();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "添加时间线失败。"); }
    finally { setBusy(false); }
  }
  function draftEdit() {
    window.dispatchEvent(new CustomEvent("loomic:video-draft", { detail: `请剪辑当前时间线中的画布录像，先给出可预览的剪辑方案，字幕、配音和转场逐项确认后再执行。\n素材标题（仅供参考）：${JSON.stringify(source?.title ?? "画布视频")}` }));
  }
  if (!source) return null;
  const canvasHref = /^[a-f\d-]{36}$/i.test(source.returnCanvas) ? `/canvas/?id=${source.returnCanvas}` : null;
  return <section className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-4 py-3 text-sm" aria-label="画布视频剪辑">
    <p className="min-w-0 flex-1" role={error ? "alert" : "status"}>{error || (inTimeline ? "画布视频已加入剪辑时间线，可以继续对话编辑。" : file ? `已导入 ${source.title}，保留画布中的裁剪范围。` : "正在导入画布视频…")}</p>
    {error && <Button size="sm" variant="outline" disabled={busy} onClick={() => setRevision(value => value + 1)}>重试导入</Button>}
    {file && !inTimeline && <Button size="sm" disabled={busy} onClick={addClip}>{busy ? "正在添加…" : "加入剪辑时间线"}</Button>}
    {inTimeline && <Button size="sm" onClick={draftEdit}>让 AI 剪辑</Button>}
    {canvasHref && <a href={canvasHref} className="inline-flex min-h-9 items-center px-3 underline">返回画布</a>}
  </section>;
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
