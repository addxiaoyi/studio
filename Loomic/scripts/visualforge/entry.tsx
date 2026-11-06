import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserStudio } from "../../vendor/visualforge/packages/browser-studio/src/BrowserStudio";
import { createBlankTemplateProject } from "../../vendor/visualforge/packages/browser-studio/src/templates/blank";
import type { VirtualProject } from "../../vendor/visualforge/packages/browser-studio/src/types";
import { readStudioProject, saveStudioProject, saveStudioExport, type StudioExport } from "../../apps/web/src/lib/visualforge-storage";
import { lockStudio, studioImportName } from "../../apps/web/src/lib/visualforge-session";
import type { StudioHost, StudioSnapshot, StudioEdit } from "../../apps/web/src/lib/visualforge-runtime";
import type { StudioCut } from "../../apps/web/src/lib/studio-cut";
import { applyStudioCut, currentCompositionId, listStudioMedia, readStudioMedia } from "./cut";
import { installStudioChinese } from "./studio-i18n";
declare global {
  interface Window {
    loomicSaveStudioExport?: ((output: StudioExport) => Promise<void>) | undefined;
    loomicDisposeStudio?: () => void;
  }
}

export async function mountVisualForge(container: HTMLElement, host: StudioHost) {
  if (!crossOriginIsolated) throw new Error("视频编辑器需要隔离的浏览器环境。请通过侧栏重新打开；若仍失败，请检查网站响应头。");
  host.signal.throwIfAborted();
  const release = await lockStudio(host.userId);
  let project: VirtualProject & { loomicCut?: StudioCut };
  try {
    project = await readStudioProject<VirtualProject & { loomicCut?: StudioCut }>(host.userId) ?? createBlankTemplateProject();
    host.signal.throwIfAborted();
  } catch (cause) { release(); throw cause; }
  let currentProject = project;
  let currentCut = project.loomicCut ?? null;
  const imports = new Set<string>();
  const assetImports = new Map<string, Promise<void>>();
  const notifyReady = () => { if (!host.signal.aborted) host.ready(); };
  window.addEventListener("remotion-browser-studio-operations-ready", notifyReady);
  localStorage.setItem("remotion.studio.theme", host.theme);
  window.loomicSaveStudioExport = async output => {
    try {
      await saveStudioExport(host.userId, output);
      host.exported(output);
      host.status("导出文件已缓存在本机，可预览或保存到素材库");
    } catch (cause) {
      host.exported(output);
      host.error(`本机导出缓存写入失败，请保留已下载的文件：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
  const root = createRoot(container);
  const disposeTranslations = installStudioChinese(container);
  let queue = Promise.resolve();
  let saveFailure: Error | null = null;
  root.render(<BrowserStudio project={project} initialElement={null} readOnly={false}
    onProjectChange={next => {
      currentProject = { ...next, ...(currentCut ? { loomicCut: currentCut } : {}) };
      const saved = currentProject;
      queue = queue.then(() => saveStudioProject(host.userId, saved)).then(() => { saveFailure = null; host.status("工程已保存在本机"); })
        .catch(cause => { saveFailure = cause instanceof Error ? cause : new Error(String(cause)); host.error(`工程保存失败：${saveFailure.message}`); });
    }}
    onCompileStateChange={state => {
      if (state.status === "error") host.error(state.error.message);
      else host.status(state.status === "compiling" ? "正在编译工程…" : "编辑器已就绪");
    }}
  />);
  return {
    dispose() { disposeTranslations(); window.removeEventListener("remotion-browser-studio-operations-ready", notifyReady); root.unmount(); window.loomicSaveStudioExport = undefined; void queue.finally(release); },
    setTheme(theme: string) {
      localStorage.setItem("remotion.studio.theme", theme);
      document.documentElement.setAttribute("data-remotion-studio-theme", theme);
      window.dispatchEvent(new StorageEvent("storage", { key: "remotion.studio.theme", newValue: theme }));
    },
    listMedia: () => listStudioMedia(currentProject),
    readMedia: (name: string) => readStudioMedia(currentProject, name),
    async readAsset(assetId: string) {
      const media = listStudioMedia(currentProject).find(item => item.name.startsWith(`generated-${assetId}-`));
      return media ? readStudioMedia(currentProject, media.name) : null;
    },
    readCut: () => currentCut,
    projectId: () => currentCompositionId() ?? "current-project",
    async snapshot(): Promise<StudioSnapshot> {
      const operations = window.remotion_browserStudio as typeof window.remotion_browserStudio & {
        loomicSnapshot(id: string): Promise<Omit<StudioSnapshot, "cut">>;
      };
      const id = currentCompositionId();
      if (!operations?.loomicSnapshot || !id) throw new Error("请等待编辑器加载并选择当前合成。");
      const snapshot = await operations.loomicSnapshot(id);
      const saved = (currentProject as typeof currentProject & { loomicCuts?: Record<string, { revision: string; cut: StudioCut }> }).loomicCuts?.[id];
      return { ...snapshot, cut: saved?.revision === snapshot.revision ? saved.cut : null,
        appliedEdits: (currentProject as typeof currentProject & { loomicAppliedEdits?: string[] }).loomicAppliedEdits ?? [] };
    },
    async applyEdit(edit: StudioEdit) {
      host.signal.throwIfAborted();
      if (currentCompositionId() !== edit.compositionId) throw new Error("当前合成已切换，请重新生成计划。");
      const operations = window.remotion_browserStudio as typeof window.remotion_browserStudio & { loomicApplyEdit(edit: StudioEdit): Promise<void> };
      if (!operations?.loomicApplyEdit) throw new Error("编辑器版本不支持安全应用计划，请刷新。");
      await operations.loomicApplyEdit(edit);
      await queue;
      if (saveFailure) throw saveFailure;
      await saveStudioProject(host.userId, currentProject);
      host.status("AI 计划已保存到当前合成，可使用撤销恢复");
    },
    async applyCut(cut: StudioCut) {
      host.signal.throwIfAborted();
      for (const clip of cut.clips) {
        if (!currentProject.publicFiles?.[clip.name]) throw new Error("快剪素材已不在当前工程，请重新选择。");
      }
      for (const audio of cut.audio ?? []) {
        if (!currentProject.publicFiles?.[audio.assetName]) throw new Error("Audio asset is not available in the current project.");
      }
      await applyStudioCut(cut);
      await queue;
      if (saveFailure) throw saveFailure;
      currentCut = structuredClone(cut);
      currentProject = { ...currentProject, loomicCut: currentCut };
      await saveStudioProject(host.userId, currentProject);
      host.status("快剪方案已加入当前工程，可在时间线继续编辑");
    },
    async importAsset(file: File, assetId?: string) {
      host.signal.throwIfAborted();
      const operations = window.remotion_browserStudio;
      if (!operations) throw new Error("请等待编辑器就绪后导入素材。");
      const bytes = await file.arrayBuffer();
      let name = file.name;
      if (assetId) {
        if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(assetId)) throw new Error("生成素材标识无效。");
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
        name = `generated-${assetId}-${hash.slice(0, 16)}.${file.name.split(".").pop()}`;
        const pending = assetImports.get(name);
        if (pending) return pending;
        if (currentProject.publicFiles?.[name]) {
          await queue;
          if (saveFailure) throw saveFailure;
          return;
        }
      }
      const safeName = studioImportName(name, [...Object.keys(currentProject.publicFiles || {}), ...imports]);
      imports.add(safeName);
      const save = (async () => {
        try {
          host.signal.throwIfAborted();
          await operations.writeStaticFile({ filePath: safeName, contents: bytes });
          await queue;
          if (saveFailure) throw saveFailure;
          host.status(assetId ? "生成素材已加入当前工程的素材面板" : "素材已导入编辑器，请在“素材”面板添加到时间线");
        } finally { imports.delete(safeName); assetImports.delete(name); }
      })();
      if (assetId) assetImports.set(name, save);
      return save;
    },
  };
}
