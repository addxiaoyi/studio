"use client";
import { useCallback, useEffect, useRef } from "react";
import type { WorkflowDocument, WorkflowGraph } from "@helstera/shared";
import {
  nodeElementId,
  adoptWorkflowCopies,
  placeWorkflow,
  projectWorkflow,
  readSceneWorkflow,
  workflowBinding,
  type SceneElement,
  type WorkflowCanvasApi,
  type NodePreview,
} from "./scene";

function signature(graph: WorkflowGraph) {
  return JSON.stringify({
    ...graph,
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...graph.edges].sort((a, b) => a.id.localeCompare(b.id)),
  });
}
type Options = {
  api: WorkflowCanvasApi | null;
  document: WorkflowDocument | null;
  graph: WorkflowGraph;
  states: Record<string, string>;
  locked: boolean;
  open: boolean;
  previews?: Record<string,NodePreview>;
  edit(graph: WorkflowGraph, checkpoint?: boolean): void;
  select(workflowId: string, nodeId: string): void;
  error(message: string): void;
};
export function useCanvasWorkflowScene(options: Options) {
  const current = useRef(options);
  current.current = options;
  const initialized = useRef<string | null>(null),
    projecting = useRef(false);
  const consumed = useRef(new Set<string>());
  const needsFocus = useRef(false);
  const focus = useCallback((nodeId?: string) => {
    const { api, document, graph, open } = current.current;
    if (!api || !document) return;
    const ids = new Set(
      graph.nodes
        .filter((node) => !nodeId || node.id === nodeId)
        .map((node) => nodeElementId(document.id, node)),
    );
    const targets = api.getSceneElements().filter((el) => ids.has(el.id));
    if (!targets.length) return;
    const state = api.getAppState(),
      narrow = state.width <= 760;
    const left = Math.min(...targets.map((el) => el.x)),
      top = Math.min(...targets.map((el) => el.y));
    const width = Math.max(...targets.map((el) => el.x + el.width)) - left;
    const height = Math.max(...targets.map((el) => el.y + el.height)) - top;
    const availableWidth = Math.max(
      150,
      state.width - 140 - (open && !narrow ? 360 : 0),
    );
    const availableHeight = Math.max(
      150,
      state.height * (open && narrow ? 0.42 : 0.8) - 80,
    );
    const zoom = Math.max(
      0.1,
      Math.min(
        1,
        availableWidth / Math.max(width, 1),
        availableHeight / Math.max(height, 1),
      ),
    );
    api.updateScene({
      appState: {
        zoom: { value: zoom },
        scrollX: (85 + (availableWidth - width * zoom) / 2) / zoom - left,
        scrollY: (100 + (availableHeight - height * zoom) / 2) / zoom - top,
      },
      captureUpdate: "NEVER",
    });
    if (nodeId)
      api.updateScene({
        appState: {
          selectedElementIds: Object.fromEntries(
            targets.map((el) => [el.id, true]),
          ),
        },
        captureUpdate: "NEVER",
      });
  }, []);
  useEffect(() => {
    const { api, document, graph, states, locked } = options;
    if (!api || !document) return;
    const first = initialized.current !== document.id;
    if (first) needsFocus.current = true;
    initialized.current = document.id;
    const scene = api.getSceneElementsIncludingDeleted();
    if (
      first &&
      graph.nodes.length &&
      !scene.some((el) => workflowBinding(el)?.workflowId === document.id)
    ) {
      const positioned = placeWorkflow(graph, scene, api.getAppState());
      current.current.edit(positioned, false);
      return;
    }
    const pending = scene.map((el) =>
      consumed.current.has(el.id) ? { ...el, isDeleted: true } : el,
    );
    const projected = projectWorkflow(
      pending,
      document.id,
      graph,
      states,
      locked,
      options.previews,
    );
    if (JSON.stringify(projected) !== JSON.stringify(scene)) {
      projecting.current = true;
      api.updateScene({ elements: projected, captureUpdate: "NEVER" });
      projecting.current = false;
    }
    consumed.current.clear();
    if (needsFocus.current) {
      needsFocus.current = false;
      if (options.open) focus();
    }
  }, [
    options.api,
    options.document?.id,
    options.graph,
    options.states,
    options.previews,
    options.locked,
    focus,
  ]);
  useEffect(() => {
    if (options.open) focus();
  }, [options.open, focus]);
  useEffect(() => {
    const api = options.api;
    if (!api) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastSelection = "";
    const sync = () => {
      const { document, graph, locked, edit, error } = current.current;
      if (!document || locked || projecting.current) return;
      const before = api.getSceneElementsIncludingDeleted();
      const scene = adoptWorkflowCopies(before, document.id);
      if (JSON.stringify(before) !== JSON.stringify(scene)) {
        projecting.current = true;
        api.updateScene({
          elements: scene,
          appState: { selectedElementIds: {} },
          captureUpdate: "NEVER",
        });
        projecting.current = false;
      }
      const next = readSceneWorkflow(scene, document.id, graph);
      if (next.issues.length) error(next.issues.join("\n"));
      if (signature(next.graph) !== signature(graph)) {
        next.consumedArrows.forEach((id) => consumed.current.add(id));
        edit(next.graph);
      }
    };
    const unsubscribe = api.onChange((elements, state) => {
      if (projecting.current) return;
      const selection = Object.keys(state.selectedElementIds ?? {})
        .filter((id) => state.selectedElementIds[id])
        .sort()
        .join(",");
      if (selection !== lastSelection) {
        lastSelection = selection;
        const chosen = elements.find(
          (el) => state.selectedElementIds[el.id] && workflowBinding(el),
        );
        const binding = chosen && workflowBinding(chosen);
        if (binding)
          current.current.select(binding.workflowId, binding.node.id);
      }
      clearTimeout(timer);
      timer = setTimeout(sync, 120);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [options.api]);
  const locateResults = useCallback((ids: string[]) => {
    const api = current.current.api;
    if (!api) return;
    const targets: readonly SceneElement[] = api
      .getSceneElements()
      .filter((el) => ids.includes(el.id));
    if (targets.length)
      api.scrollToContent(targets, {
        fitToViewport: true,
        animate: false,
        maxZoom: 1,
      });
  }, []);
  return { focus, locateResults };
}
