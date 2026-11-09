export type StudioPhase = "runtime" | "project" | "download" | "compile" | "preview" | "ready";
export type StudioStage = { phase: StudioPhase; loadedBytes?: number; totalBytes?: number };
export type StudioStartup = StudioStage & { elapsedSeconds: number; phaseSeconds: number; timedOut: boolean };
export const STUDIO_STAGE_EVENT = "helstera:studio-stage";

const deadlines: Record<StudioPhase, number> = {
  runtime: 60_000, project: 15_000, download: 90_000, compile: 45_000, preview: 30_000, ready: Infinity,
};
export const studioPhaseLabels: Record<StudioPhase, string> = {
  runtime: "正在加载编辑器组件", project: "正在恢复本机工程", download: "正在下载编译资源",
  compile: "正在编译视频工程", preview: "正在准备时间线预览", ready: "编辑器已就绪",
};

export function watchStudioStartup(change: (state: StudioStartup) => void, timeout: (state: StudioStartup) => void) {
  const started = Date.now();
  let phaseStarted = started, disposed = false, failed = false;
  let current: StudioStage = { phase: "runtime" };
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => { clearInterval(timer); timer = undefined; };
  const publish = () => {
    const now = Date.now();
    const state = { ...current, elapsedSeconds: Math.floor((now - started) / 1000), phaseSeconds: Math.floor((now - phaseStarted) / 1000), timedOut: now - phaseStarted >= deadlines[current.phase] };
    change(state);
    if (state.timedOut) { failed = true; stop(); timeout(state); }
  };
  const start = () => { if (!timer) timer = setInterval(publish, 1000); };
  start();
  publish();
  return {
    stage(stage: StudioStage) {
      if (disposed || failed) return;
      if (stage.phase !== current.phase) phaseStarted = Date.now();
      current = stage;
      if (stage.phase === "ready") stop(); else start();
      publish();
    },
    dispose() { disposed = true; stop(); },
  };
}
