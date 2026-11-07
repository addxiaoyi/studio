import type { StudioExport } from "./visualforge-storage";
import type { StudioCut, StudioMedia } from "./studio-cut";
import type { StudioAiContext } from "./studio-ai-context";

export type StudioSnapshot = { compositionId: string; revision: string; duration: number; format: StudioCut["format"]; captions: NonNullable<StudioCut["captions"]>; cut: StudioCut | null; appliedEdits?: string[] };
export type StudioEdit = { id: string; compositionId: string; revision: string; cut: StudioCut; replaceVideo: boolean };

export type StudioRuntime = {
  dispose(): void;
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
};
export type StudioHost = {
  userId: string;
  theme: string;
  signal: AbortSignal;
  status(message: string): void;
  ready(): void;
  error(message: string): void;
  exported(output: StudioExport): void;
  openAi?(context: StudioAiContext): boolean;
};
export type StudioModule = {
  mountVisualForge(container: HTMLElement, host: StudioHost): Promise<StudioRuntime>;
};

export function loadVisualForge(): Promise<StudioModule> {
  const entry = "/creative/visualforge/entry.mjs";
  return import(/* webpackIgnore: true */ entry) as Promise<StudioModule>;
}
