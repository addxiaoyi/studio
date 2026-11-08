"use client";
import { useEffect, useRef, useState } from "react";
import {
  workflowBinding,
  type CanvasState,
  type SceneElement,
  type WorkflowCanvasApi,
} from "./scene";
type View = {
  elements: readonly SceneElement[];
  state: CanvasState;
  root: HTMLElement;
};

export function hitWorkflowCard(
  api: WorkflowCanvasApi,
  root: HTMLElement,
  event: MouseEvent,
  margin = 0,
) {
  const state = api.getAppState(),
    zoom = state.zoom.value,
    box = root.getBoundingClientRect();
  const x = (event.clientX - box.left) / zoom - state.scrollX,
    y = (event.clientY - box.top) / zoom - state.scrollY;
  return [...api.getSceneElements()]
    .reverse()
    .find(
      (el) =>
        !el.isDeleted &&
        workflowBinding(el) &&
        x >= el.x - margin / zoom &&
        x <= el.x + el.width + margin / zoom &&
        y >= el.y - (margin ? 36 : 0) / zoom &&
        y <= el.y + el.height,
    );
}
function viewSignature(elements: readonly SceneElement[], state: CanvasState) {
  return JSON.stringify([
    elements
      .filter((el) => el.customData?.workflow || el.customData?.workflowEdge)
      .map((el) => [el.id, el.version]),
    state.scrollX,
    state.scrollY,
    state.zoom.value,
    state.width,
    state.height,
    state.selectedElementIds,
    state.selectedElementsAreBeingDragged,
    state.activeTool?.type,
    Boolean(state.contextMenu),
  ]);
}
export function useWorkflowLayerView(api: WorkflowCanvasApi | null) {
  const [view, setView] = useState<View | null>(null),
    [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-canvas-surface]");
    if (!api || !root) return;
    let frame = 0,
      last = "";
    const update = () => {
      frame = 0;
      const state = api.getAppState(),
        elements = api.getSceneElements(),
        signature = viewSignature(elements, state);
      if (signature === last) return;
      last = signature;
      setView({ elements: [...elements], state: { ...state }, root });
    };
    const unsubscribe = api.onChange(() => {
      if (!frame) frame = requestAnimationFrame(update);
    });
    update();
    const over = (event: PointerEvent) => {
      if (!event.buttons) setHover(hitWorkflowCard(api, root, event, 25)?.id ?? null);
    };
    const leave = () => setHover(null);
    root.addEventListener("pointermove", over);
    root.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      root.removeEventListener("pointermove", over);
      root.removeEventListener("pointerleave", leave);
    };
  }, [api]);
  return { view, hover };
}
export function useWorkflowNodeEdit(
  api: WorkflowCanvasApi | null,
  onEdit: (workflowId: string, nodeId: string) => void,
) {
  const latest = useRef(onEdit);
  latest.current = onEdit;
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-canvas-surface]");
    if (!api || !root) return;
    const edit = (element: SceneElement, event: Event) => {
      const binding = workflowBinding(element);
      if (!binding) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current(binding.workflowId, binding.node.id);
    };
    const doubleClick = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLCanvasElement)) return;
      const element = hitWorkflowCard(api, root, event);
      if (element) edit(element, event);
    };
    const key = (event: KeyboardEvent) => {
      if (
        !["Enter", "F2"].includes(event.key) ||
        !(event.target instanceof HTMLElement) ||
        event.target.closest("input,textarea,button,[contenteditable=true]")
      )
        return;
      const chosen = api
        .getSceneElements()
        .filter((el) => api.getAppState().selectedElementIds[el.id]);
      if (chosen.length === 1 && chosen[0]) edit(chosen[0], event);
    };
    root.addEventListener("dblclick", doubleClick, true);
    root.addEventListener("keydown", key, true);
    return () => {
      root.removeEventListener("dblclick", doubleClick, true);
      root.removeEventListener("keydown", key, true);
    };
  }, [api]);
}
