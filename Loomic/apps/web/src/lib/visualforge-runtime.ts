import type { StudioExport } from "./visualforge-storage";
import type { StudioCut, StudioMedia } from "./studio-cut";
import type { StudioAiContext } from "./studio-ai-context";
import type { VideoEditorAction, VideoEditorLayer, VideoStudioState, VideoStudioControl } from "@helstera/shared";
import type { CanvasTimeline } from "./canvas-timeline";
import type { StudioStage } from "./studio-startup";
import type { ProjectVideoDocument } from "@helstera/shared";

export type StudioEditReceipt = { id: string; revision: string; originalRevision: string; undone: number[]; complete: boolean; canUndo: boolean };
export type StudioUndo = { id: string; compositionId: string; revision: string; actionIndex?: number };
export type StudioSnapshot = { compositionId: string; revision: string; duration: number; format: StudioCut["format"]; fps?: number; width?: number; height?: number; layers?: VideoEditorLayer[]; captions: NonNullable<StudioCut["captions"]>; cut: StudioCut | null; appliedEdits?: string[]; editReceipt?: StudioEditReceipt };
export type StudioEdit = { id: string; compositionId: string; revision: string; cut: StudioCut; replaceVideo: boolean; commands?: VideoEditorAction[] };

export type StudioRuntime = {
  dispose(): void;
  flush?(): Promise<void>;
  portableProject?(): Promise<ProjectVideoDocument>;
  setTheme(theme: string): void;
  importAsset(file: File, assetId?: string): Promise<void>;
  listMedia(): StudioMedia[];
  readMedia(name: string): Promise<File>;
  readAsset(assetId: string): Promise<File | null>;
  readCut(): StudioCut | null;
  projectId(): string;
  snapshot(): Promise<StudioSnapshot>;
  applyEdit(edit: StudioEdit): Promise<void>;
  applyCut(cut: StudioCut): Promise<void>;
  importCanvasTimeline?(timeline: CanvasTimeline, names: Record<string, string>, fingerprint: string): Promise<string>;
  openExport(): void;
  selectComposition(id: string): void;
  undoEdit(input: { id: string; compositionId: string; appliedRevision: string; originalRevision: string }): Promise<void>;
  undoAction(input: StudioUndo): Promise<StudioSnapshot>;
  studioState(): Promise<VideoStudioState>;
  control(input: VideoStudioControl, compositionId: string): Promise<string>;
};
export type StudioHost = {
  userId: string;
  projectKey?: string | undefined;
  projectContext?: { projectId: string; canvasId: string; hasSavedComposition: boolean } | undefined;
  theme: string;
  signal: AbortSignal;
  status(message: string): void;
  stage?(stage: StudioStage): void;
  ready(): void;
  error(message: string): void;
  exported(output: StudioExport): void;
  openAi?(context: StudioAiContext): boolean;
};
export type StudioModule = {
  mountVisualForge(container: HTMLElement, host: StudioHost): Promise<StudioRuntime>;
  restoreStudioDocument?(input: {projectKey:string;document:ProjectVideoDocument;files:Record<string,File>;expectedLocalHash?:string|null}): Promise<string|null>;
  restoreStudioRecovery?(input:{projectKey:string;backupKey:string;expectedLocalHash:string|null}):Promise<void>;
};

export function loadVisualForge(attempt = 0): Promise<StudioModule> {
  const entry = `/creative/visualforge/entry.mjs?release=project-video-sync-20261111&attempt=${attempt}`;
  return import(/* webpackIgnore: true */ entry) as Promise<StudioModule>;
}
