"use client";
import { useEffect, useRef, useState } from "react";
import type { WorkflowGraph } from "@helstera/shared";
import { embedWorkflowMaterials } from "./material-inputs";
import {
  workflowBinding,
  type SceneElement,
  type WorkflowCanvasApi,
} from "./scene";

type Rect = { x: number; y: number; width: number; height: number };
export type MaterialDropCue = {
  key: number;
  rect: Rect;
  from: { x: number; y: number };
  label: string;
  phase: "ready" | "blocked" | "embedded";
};
type Options = {
  api: WorkflowCanvasApi | null;
  workflowId: string | undefined;
  graph: WorkflowGraph;
  locked: boolean;
  edit(graph: WorkflowGraph): void;
  select(nodeId: string): void;
  error(message: string): void;
};
const isMedia = (el: SceneElement) =>
  el.type === "image" || el.customData?.isVideo === true;

export function useWorkflowMaterialDrop(options: Options) {
  const current = useRef(options);
  current.current = options;
  const dragging = useRef(false);
  const [cue, setCue] = useState<MaterialDropCue | null>(null);
  useEffect(() => {
    const api = options.api;
    if (!api?.onPointerDown || !api.onPointerUp) return;
    let drag: {
      pointerId: number;
      workflowId: string;
      sources: SceneElement[];
      root: HTMLElement;
    } | null = null;
    let frame = 0,
      sequence = 0,
      lastTarget = "";
    const cancel = () => {
      drag = null;
      dragging.current = false;
      lastTarget = "";
      setCue(null);
    };
    const findTarget = (event: PointerEvent) => {
      if (!drag || drag.workflowId !== current.current.workflowId) return null;
      const top = document.elementFromPoint(event.clientX, event.clientY);
      if (
        !top ||
        !drag.root.contains(top) ||
        top.closest("[data-canvas-toolbar],[role=dialog]")
      )
        return null;
      const state = api.getAppState(),
        box = drag.root.getBoundingClientRect(),
        zoom = state.zoom.value;
      const offsetX = state.offsetLeft ?? box.left,
        offsetY = state.offsetTop ?? box.top;
      const point = {
        x: (event.clientX - offsetX) / zoom - state.scrollX,
        y: (event.clientY - offsetY) / zoom - state.scrollY,
      };
      const target = [...api.getSceneElements()].reverse().find((el) => {
        const binding = workflowBinding(el);
        if (
          !binding ||
          binding.workflowId !== drag!.workflowId ||
          binding.node.config.kind === "asset"
        )
          return false;
        const angle = Number(el.angle) || 0,
          dx = point.x - el.x - el.width / 2,
          dy = point.y - el.y - el.height / 2;
        return (
          Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle)) <=
            el.width / 2 &&
          Math.abs(dy * Math.cos(angle) - dx * Math.sin(angle)) <= el.height / 2
        );
      });
      if (!target) return null;
      return {
        nodeId: workflowBinding(target)!.node.id,
        rect: {
          x: (target.x + state.scrollX) * zoom + offsetX,
          y: (target.y + state.scrollY) * zoom + offsetY,
          width: target.width * zoom,
          height: target.height * zoom,
        },
      };
    };
    const check = (targetId: string) => {
      const scope = current.current;
      if (scope.locked)
        throw new Error("当前流程正在执行，请结束后再修改参考素材。");
      return embedWorkflowMaterials(scope.graph, drag!.sources, targetId);
    };
    const down = api.onPointerDown((tool, state, event) => {
      cancel();
      if (
        tool.type !== "selection" ||
        state.resize.handleType ||
        !state.hit.element ||
        !current.current.workflowId
      )
        return;
      const hit = state.hit.element as unknown as SceneElement;
      if (!isMedia(hit)) return;
      const root = (event.target as Element).closest<HTMLElement>(
        "[data-canvas-surface]",
      );
      if (!root) return;
      const selected = api.getAppState().selectedElementIds;
      const sources = api
        .getSceneElements()
        .filter(
          (el) => el.id === hit.id || (selected[hit.id] && selected[el.id]),
        );
      if (
        sources.some(
          (el) =>
            !isMedia(el) ||
            (workflowBinding(el)?.workflowId &&
              workflowBinding(el)!.workflowId !== current.current.workflowId),
        )
      )
        return;
      drag = {
        pointerId: event.pointerId,
        workflowId: current.current.workflowId,
        sources: sources.map((el) => ({ ...el })),
        root,
      };
      dragging.current = true;
    });
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const changed = drag.sources.some((original) => {
        const live = api.getSceneElements().find((el) => el.id === original.id);
        return (
          live &&
          (Math.abs(live.x - original.x) + Math.abs(live.y - original.y)) *
            api.getAppState().zoom.value >
            5
        );
      });
      if (!changed) return;
      const target = findTarget(event);
      if (!target) {
        if (lastTarget) setCue(null);
        lastTarget = "";
        return;
      }
      if (lastTarget === target.nodeId) return;
      lastTarget = target.nodeId;
      let label = `松开嵌入 ${drag.sources.length} 项参考素材`,
        phase: MaterialDropCue["phase"] = "ready";
      try {
        check(target.nodeId);
      } catch (cause) {
        phase = "blocked";
        label =
          cause instanceof Error ? cause.message : "此节点不能接收该素材。";
      }
      setCue({
        key: ++sequence,
        rect: target.rect,
        from: { x: event.clientX, y: event.clientY },
        label,
        phase,
      });
    };
    const up = api.onPointerUp((_tool, state, event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const target =
        state.drag.hasOccurred &&
        !state.resize.isResizing &&
        !state.hit.hasBeenDuplicated
          ? findTarget(event)
          : null;
      if (!target) {
        cancel();
        return;
      }
      const originals = drag.sources;
      let next: WorkflowGraph | null = null,
        failure = "";
      try {
        next = check(target.nodeId);
      } catch (cause) {
        failure =
          cause instanceof Error ? cause.message : "嵌入失败，请重新选择素材。";
      }
      drag = null;
      // Let Excalidraw finish its drag before restoring the original media positions.
      frame = requestAnimationFrame(() => {
        const restored = api.getSceneElementsIncludingDeleted().map((el) => {
          const original = originals.find((source) => source.id === el.id);
          return original
            ? {
                ...el,
                x: original.x,
                y: original.y,
                version: (el.version ?? 0) + 1,
                versionNonce: Math.floor(Math.random() * 2e9),
                updated: Date.now(),
              }
            : el;
        });
        api.updateScene({ elements: restored, captureUpdate: "IMMEDIATELY" });
        dragging.current = false;
        if (!next) {
          setCue(null);
          current.current.error(failure);
          return;
        }
        current.current.edit(next);
        current.current.select(target.nodeId);
        current.current.error("");
        setCue({
          key: ++sequence,
          rect: target.rect,
          from: { x: event.clientX, y: event.clientY },
          label: `已嵌入 ${originals.length} 项参考素材，运行后逐次确认费用`,
          phase: "embedded",
        });
      });
    });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      down();
      up();
      cancelAnimationFrame(frame);
      dragging.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
    };
  }, [options.api]);
  return { dragging, cue, clearCue: () => setCue(null) };
}
