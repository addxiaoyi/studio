"use client";

import { StudioAssetPicker } from "@/components/studio-asset-picker";
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
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./visualforge-workspace.module.css";
import { useVideoText } from "@/lib/video-copy";
import type { StudioAiContext } from "@/lib/studio-ai-context";

export function VisualForgeWorkspace() {
  const copy = useVideoText();
  const { session } = useAuth();
  const { resolvedTheme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<StudioRuntime | null>(null);
  const [status, setStatus] = useState("正在加载视频创作工作台…");
  const [error, setError] = useState("");
  const [outputs, setOutputs] = useState<StudioExport[]>([]);
  const [ready, setReady] = useState(false);
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
  const token = session?.access_token;

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
    if (!userId || !container.current) return;
    const abort = new AbortController();
    let mounted: StudioRuntime | null = null;
    void listStudioExports(userId)
      .then((saved) => {
        if (!abort.signal.aborted)
          setOutputs(saved.sort((a, b) => b.createdAt - a.createdAt));
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setError(`无法读取本机导出记录：${cause.message}`);
      });
    void loadVisualForge()
      .then(async (module) => {
        if (abort.signal.aborted || !container.current) return;
        mounted = await module.mountVisualForge(container.current, {
          userId,
          theme: theme.current,
          signal: abort.signal,
          status: (message) => {
            if (!abort.signal.aborted) setStatus(message);
          },
          ready: () => {
            if (!abort.signal.aborted) setReady(true);
          },
          openAi: context => receiveAi.current(context),
          error: (message) => {
            if (!abort.signal.aborted) setError(message);
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
        setStatus("编辑器暂不可用");
        setError(
          cause instanceof Error
            ? cause.message
            : "视频编辑器加载失败，请重试。",
        );
      });
    return () => {
      abort.abort();
      mounted?.dispose();
      setMountedRuntime(null);
      if (runtime.current === mounted) runtime.current = null;
    };
  }, [userId, retry]);

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
            className="flex flex-wrap items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            <span className="min-w-0 flex-1 break-words">{error}</span>
            <Button variant="outline" size="sm" onClick={reopen}>
              <RefreshCw className="size-3" aria-hidden="true" />
              {copy("重新打开编辑器")}
            </Button>
          </div>
        )}
        <div className={styles.body} hidden={transcriptOpen}>
          <div ref={container} data-testid="video-studio" className={styles.studio} />
          <div id="video-ai-panel" className={styles.ai} hidden={!aiOpen}>{userId && token && <StudioConversationPanel runtime={ready ? mountedRuntime : null} mediaRevision={mediaRevision} userId={userId} token={token} exported={exported} contextRequest={aiContext} active={aiOpen} onBusyChange={updateAiBusy} onViewTimeline={viewTimeline} onOpenPanel={openPanel} />}</div>
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
