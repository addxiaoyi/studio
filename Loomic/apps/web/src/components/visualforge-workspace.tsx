"use client";
import {keepStudioBrandTitle} from "@/lib/studio-brand";

import { StudioAssetPicker } from "@/components/studio-asset-picker";
import { CanvasVideoImport, CaptureRecordingImport } from "@/components/capture-recording-import";
import { CanvasTimelineImport } from "@/components/canvas-timeline-import";
import { rememberStudioProject } from "@/lib/studio-project-key";
import { StudioConversationPanel } from "@/components/studio-conversation-panel";
import { StudioExportCard } from "@/components/studio-export-card";
import { OneTakeWorkspace } from "@/components/onetake/workspace";
import { useLocale } from "@/lib/i18n";
import { oneTakeCopy } from "@/lib/onetake-copy";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { type StudioRuntime, loadVisualForge } from "@/lib/visualforge-runtime";
import {
  type StudioExport,
  listStudioExports,
} from "@/lib/visualforge-storage";
import { Film, RefreshCw } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import styles from "./visualforge-workspace.module.css";
import { useVideoText } from "@/lib/video-copy";
import type { StudioAiContext } from "@/lib/studio-ai-context";
import { watchStudioStartup, studioPhaseLabels, type StudioStartup } from "@/lib/studio-startup";
import { StudioLoading } from "./studio-loading";
import { useProjectContext } from "@/hooks/use-project-context";
import { ProjectViewNav } from "./project-view-nav";
import { projectViewHref, type ProjectView } from "@helstera/shared";

export function VisualForgeWorkspace() {
  useEffect(keepStudioBrandTitle,[]);
  const copy = useVideoText();
  const { session } = useAuth();
  const { resolvedTheme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<StudioRuntime | null>(null);
  const [status, setStatus] = useState("正在加载视频创作工作台…");
  const [error, setError] = useState("");
  const [outputs, setOutputs] = useState<StudioExport[]>([]);
  const [ready, setReady] = useState(false);
  const [startup, setStartup] = useState<StudioStartup>({ phase: "runtime", elapsedSeconds: 0, phaseSeconds: 0, timedOut: false });
  const [mountedRuntime, setMountedRuntime] = useState<StudioRuntime | null>(null);
  const [mediaRevision, setMediaRevision] = useState(0);
  const [retry, setRetry] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptDirty, setTranscriptDirty] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [aiContext, setAiContext] = useState<StudioAiContext | null>(null);
  const aiBusy = useRef(false);
  const exportsRef = useRef<HTMLElement>(null);
  const exportStartedAt = useRef(Date.now());
  const updateAiBusy = useCallback((value: boolean) => { aiBusy.current = value; }, []);
  const recordingImported=useCallback(()=>{setMediaRevision(value=>value+1);setAiOpen(true);},[]);
  const viewTimeline = useCallback(() => setAiOpen(false), []);
  const receiveAi = useRef<(context: StudioAiContext) => boolean>(() => false);
  receiveAi.current = context => {
    if (aiBusy.current) { setError(copy("正在处理当前修改，请完成后再切换修改对象。"));return false; }
    if (transcriptDirty) { setError(copy("请先保存或放弃文字剪辑修改，再打开 AI 编辑。"));return false; }
    if (runtime.current && runtime.current.projectId() !== context.compositionId) {
      try { runtime.current.selectComposition(context.compositionId); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "无法选择目标视频。");return false; }
    }
    setAiContext(context);setAiOpen(true);setTranscriptOpen(false);return true;
  };
  const transcriptCopy = oneTakeCopy(useLocale());
  const exported = useCallback((output: StudioExport) => setOutputs(current => [output, ...current.filter(item => item.id !== output.id)]), []);
  const theme = useRef(resolvedTheme || "dark");
  theme.current = resolvedTheme || "dark";
  const userId = session?.user.id;
  const [projectAddress] = useState(() => typeof location === "undefined" ? "https://helstera.invalid/video/" : location.href);
  const token = session?.access_token;
  const project = useProjectContext({ userId,token,address:projectAddress,view:"video",enabled:new URL(projectAddress).searchParams.get("draft")!=="1" });
  const projectKey = userId ? project.context ? `${userId}:project:${project.context.project.id}` : rememberStudioProject(userId,projectAddress) : undefined;
  const missingLocalProject = error.startsWith("当前设备没有这个视频工程的本机副本");
  const contextRef = useRef(project.context); contextRef.current=project.context;
  useEffect(() => {
    if (!project.context) return;
    const url = new URL(location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    fragment.set("projectId",project.context.project.id);fragment.set("canvasId",project.context.canvas.id);
    url.hash=fragment.toString();history.replaceState(history.state,"",url);
  }, [project.context?.project.id,project.context?.canvas.id]);
  const beforeProjectView = async (view: ProjectView) => {
    if (aiBusy.current || transcriptDirty) throw new Error(copy("请先完成当前修改，再切换工程视图。"));
    if (runtime.current) {
      if (!runtime.current.flush) throw new Error(copy("请等待视频工程就绪后再切换。"));
      await runtime.current.flush();
    }
    await project.saveLocation(view,runtime.current?.projectId());
  };
  const leaveProject = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const href=event.currentTarget.href;
    try {
      if (aiBusy.current || transcriptDirty) throw new Error(copy("请先完成当前修改，再切换工程视图。"));
      if (runtime.current) {
        if (!runtime.current.flush) throw new Error(copy("请刷新视频工作区后再切换。"));
        await runtime.current.flush();
        await project.saveLocation("video",runtime.current.projectId());
      }
      window.location.assign(href);
    } catch(cause) { setError(cause instanceof Error?cause.message:copy("保存失败，请重试。")); }
  };
  useEffect(() => {
    if (!ready || !mountedRuntime) return;
    const composition=new URL(projectAddress).searchParams.get("composition") ?? contextRef.current?.compositionId;
    if (!composition) return;
    try { mountedRuntime.selectComposition(composition); }
    catch(cause) { setError(cause instanceof Error?cause.message:copy("当前设备尚未保存这个视频，请恢复工程后继续。")); }
  }, [ready,mountedRuntime,projectAddress]);
  useEffect(() => {
    if (!ready || !mountedRuntime) return;
    let timer: ReturnType<typeof setTimeout>;
    let alive=true;
    const changed = () => {
      clearTimeout(timer);
      timer=setTimeout(() => {
        const id=mountedRuntime.projectId();
        if (!contextRef.current || id===contextRef.current.compositionId || id==="current-project") return;
        void project.saveLocation("video",id).catch(cause => { if(alive) setError(cause instanceof Error?cause.message:copy("保存失败，请重试。")); });
      },500);
    };
    changed();window.addEventListener("remotion-pending-composition-selection",changed);
    return () => { alive=false;clearTimeout(timer);window.removeEventListener("remotion-pending-composition-selection",changed); };
  }, [ready,mountedRuntime,project.saveLocation]);

  useEffect(() => {
    if (outputs[0] && outputs[0].createdAt >= exportStartedAt.current) exportsRef.current?.scrollIntoView({ block: "start" });
  }, [outputs]);

  useEffect(() => {
    runtime.current?.setTheme(resolvedTheme || "dark");
  }, [resolvedTheme]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry releases and reacquires the editor after a load or lock failure.
  useEffect(() => {
    setOutputs([]);
    setError("");
    setReady(false);
    setMountedRuntime(null);
    setAiContext(null);
    setStatus("正在加载视频工程…");
    if (!userId || !container.current || project.loading || project.error) return;
    const abort = new AbortController();
    let mounted: StudioRuntime | null = null;
    const watchdog = watchStudioStartup(setStartup, state => {
      setReady(false);
      setError(`${studioPhaseLabels[state.phase]}超时，请重新打开已保存工程。`);
      abort.abort();
      mounted?.dispose();
      if (runtime.current === mounted) runtime.current = null;
      mounted = null;
      setMountedRuntime(null);
    });
    void listStudioExports(userId)
      .then((saved) => {
        if (!abort.signal.aborted)
          setOutputs(saved.filter(output => !contextRef.current || output.canvasId===contextRef.current.canvas.id).sort((a, b) => b.createdAt - a.createdAt));
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setError(`无法读取本机导出记录：${cause.message}`);
      });
    void loadVisualForge(retry)
      .then(async (module) => {
        if (abort.signal.aborted || !container.current) return;
        mounted = await module.mountVisualForge(container.current, {
          userId,
          projectKey,
          projectContext: contextRef.current ? { projectId:contextRef.current.project.id,canvasId:contextRef.current.canvas.id,hasSavedComposition:Boolean(contextRef.current.compositionId) } : undefined,
          theme: theme.current,
          signal: abort.signal,
          status: (message) => {
            if (!abort.signal.aborted) setStatus(message);
          },
          stage: stage => { if (!abort.signal.aborted) watchdog.stage(stage); },
          ready: () => {
            if (!abort.signal.aborted) { watchdog.stage({ phase: "ready" }); setReady(true); }
          },
          openAi: context => receiveAi.current(context),
          error: (message) => {
            if (!abort.signal.aborted) { watchdog.dispose(); setError(message); }
          },
          exported: (output) => {
            if (!abort.signal.aborted)
              setOutputs((current) => [
                output,
                ...current.filter((item) => item.id !== output.id),
              ]);
          },
        });
        if (abort.signal.aborted) mounted.dispose();
        else {
          runtime.current = mounted;
          setMountedRuntime(mounted);
          setMediaRevision((value) => value + 1);
        }
      })
      .catch((cause) => {
        if (abort.signal.aborted) return;
        watchdog.dispose();
        setStatus("编辑器暂不可用");
        setError(
          cause instanceof Error
            ? cause.message
            : "视频编辑器加载失败，请重试。",
        );
      });
    return () => {
      abort.abort();
      watchdog.dispose();
      mounted?.dispose();
      setMountedRuntime(null);
      if (runtime.current === mounted) runtime.current = null;
    };
  }, [userId, projectKey, retry, project.loading, project.error]);

  const importAsset = useCallback(async (file: File, assetId?: string) => {
    if (!runtime.current) throw new Error("请等待编辑器就绪后导入素材。");
    await runtime.current.importAsset(file, assetId);
    setMediaRevision((value) => value + 1);
  }, []);
  const reopen = () => setRetry((value) => value + 1);
  const openPanel=(panel:"assets"|"transcript"|"timeline")=>{
    if(panel==="transcript"){setTranscriptOpen(true);return;}
    setTranscriptOpen(false);if(panel==="timeline")setAiOpen(false);
    if(panel==="assets"){
      const button=document.querySelector<HTMLButtonElement>('[data-studio-assets]');
      if(!button||button.disabled)throw new Error("素材库正在处理，请稍后重试。");button.click();
    }
  };
  const openExport = () => {
    try { runtime.current?.openExport(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法打开导出设置。"); }
  };

  return (
    <section aria-label="视频创作工作台" className="min-w-0 bg-background">
      <div className={styles.frame}>
        <header className="flex min-h-16 flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-base font-semibold">
              <Film className="size-4" aria-hidden="true" />
              {copy("视频创作")}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {copy("导入素材，在同一工程里剪辑、预览和导出")}
            </p>
          </div>
        </header>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 sm:px-5">
          {project.loading ? <p role="status" className="text-sm text-muted-foreground">{copy("正在恢复工程位置…")}</p> : project.error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{project.error}</span><Button size="sm" variant="outline" onClick={project.retry}>{copy("重试")}</Button></div> : project.context ? <>
            <span className="max-w-52 truncate text-sm font-medium" title={project.context.project.name}>{project.context.project.name}</span>
            <ProjectViewNav context={project.context} current="video" beforeNavigate={beforeProjectView}/>
          </> : <span className="text-sm text-muted-foreground">{copy("本机独立草稿")}</span>}
          <a href="/projects/" onClick={leaveProject} className="min-h-9 py-2 text-xs underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring">{copy("选择工程")}</a>
          {project.context && <a href="/video/?draft=1" onClick={leaveProject} className="min-h-9 py-2 text-xs text-muted-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring">{copy("本机独立草稿")}</a>}
        </div>
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2 sm:px-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {token && (
              <StudioAssetPicker
                token={token}
                importAsset={importAsset}
                disabled={!ready}
              />
            )}
            <Button size="sm" variant="outline" aria-expanded={transcriptOpen} disabled={transcriptDirty} onClick={() => setTranscriptOpen(!transcriptOpen)}>{transcriptOpen ? transcriptCopy.close : transcriptCopy.open}</Button>
            {!transcriptOpen && <Button size="sm" variant={aiOpen ? "secondary" : "outline"} aria-expanded={aiOpen} aria-controls="video-ai-panel" onClick={() => setAiOpen(!aiOpen)}>{copy(aiOpen ? "关闭 AI 编辑" : "AI 编辑")}</Button>}
            {!transcriptOpen && <Button size="sm" variant="outline" disabled={!ready} onClick={openExport}>{copy("导出视频")}</Button>}
            <output className="min-w-0 text-xs text-muted-foreground">
              {copy(status)}
            </output>
          </div>
        </div>
        {error && (
          <div
            role="alert"
            className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            <span className="min-w-0 flex-1 break-words">{copy(error)}</span>
            {missingLocalProject && project.context ? <a href={projectViewHref(project.context,"canvas")} className="inline-flex min-h-9 items-center rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring">{copy("返回当前画布")}</a> : <Button variant="outline" size="sm" onClick={reopen}>
              <RefreshCw className="size-3" aria-hidden="true" />
              {copy("重新打开编辑器")}
            </Button>}
          </div>
        )}
        {userId&&token&&<CaptureRecordingImport userId={userId} token={token} runtime={ready?mountedRuntime:null} onImported={recordingImported}/>}
        {token&&<CanvasVideoImport token={token} runtime={ready?mountedRuntime:null} onImported={recordingImported}/>}
        {token&&<CanvasTimelineImport token={token} runtime={ready?mountedRuntime:null} onImported={recordingImported}/>}
        <div className={styles.body} hidden={transcriptOpen || missingLocalProject}>
          <div className={styles.studio}>
            <div ref={container} data-testid="video-studio" className="h-full" />
            {startup.phase !== "ready" && <StudioLoading state={startup} error={error} onRetry={reopen} />}
          </div>
          <div id="video-ai-panel" className={styles.ai} hidden={!aiOpen}>{userId && token && ready && mountedRuntime ? <StudioConversationPanel key={projectKey} runtime={mountedRuntime} mediaRevision={mediaRevision} userId={userId} projectKey={projectKey} token={token} exported={exported} contextRequest={aiContext} active={aiOpen} onBusyChange={updateAiBusy} onViewTimeline={viewTimeline} onOpenPanel={openPanel} /> : <p role="status" className="p-4 text-sm text-muted-foreground">{copy(error || project.error ? "请先恢复视频工程，再继续对话编辑。" : "正在恢复工程位置…")}</p>}</div>
        </div>
        {transcriptOpen && token && userId && <div className={styles.transcript}><OneTakeWorkspace token={token} userId={userId} runtime={ready ? mountedRuntime : null} onExport={exported} onDirty={setTranscriptDirty} /></div>}
      </div>
      {outputs.length > 0 && userId && session?.access_token && (
        <section ref={exportsRef} className="space-y-4 border-t p-4" aria-label="本机导出记录">
          <h2 className="text-sm font-semibold">{copy("成片与导出")}</h2>
          {outputs.map((output) => (
            <StudioExportCard
              key={output.id}
              output={output}
              userId={userId}
              token={session.access_token}
            />
          ))}
        </section>
      )}
    </section>
  );
}
