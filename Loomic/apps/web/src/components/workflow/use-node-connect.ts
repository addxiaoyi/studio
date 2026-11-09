"use client";
import { workflowOutlets } from "@helstera/shared";
import { useEffect, useRef, useState } from "react";
import { connectionIssue, type WorkflowGraph } from "@helstera/shared";
import { workflowBinding, type WorkflowCanvasApi } from "./scene";

type Connection = {
  source: string;
  target: string | null;
  pointer: { x: number; y: number } | null;
  issue: string | null;
  branch?:string|undefined;
};
export function useNodeConnect(options: {
  api: WorkflowCanvasApi | null;
  workflowId?: string | undefined;
  graph: WorkflowGraph;
  disabled: boolean;
  connect(source: string, target: string,branch?:string): void;
  error(message: string): void;
}) {
  const current = useRef(options);
  current.current = options;
  const [connection, setConnection] = useState<Connection | null>(null),
    latest = useRef(connection);
  latest.current = connection;
  const press = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    press.current = null;
    setConnection(null);
  };
  const finish = (target: string) => {
    const source = latest.current?.source,
      scope = current.current;
    if (!source || scope.disabled) return;
    const issue = connectionIssue(scope.graph, source, target,latest.current?.branch);
    if (issue) {
      scope.error(issue);
      setConnection((value) => (value ? { ...value, target, issue } : null));
      return;
    }
    scope.connect(source, target,latest.current?.branch);
    cancel();
  };
  useEffect(() => {
    if (!connection) return;
    const move = (event: PointerEvent) => {
      const scope = current.current,
        api = scope.api;
      if (!api) return;
      const state = api.getAppState(),
        zoom = state.zoom.value;
      const point = {
        x: (event.clientX - (state.offsetLeft ?? 0)) / zoom - state.scrollX,
        y: (event.clientY - (state.offsetTop ?? 0)) / zoom - state.scrollY,
      };
      const top = document.elementFromPoint(event.clientX, event.clientY);
      const onCanvas = top?.closest("[data-canvas-surface]");
      const target = onCanvas
        ? [...api.getSceneElements()].reverse().find((el) => {
            const binding = workflowBinding(el);
            if (
              !binding ||
              binding.workflowId !== scope.workflowId ||
              el.isDeleted ||
              binding.node.id === latest.current?.source
            )
              return false;
            return (
              point.x >= el.x - 20 / zoom &&
              point.x <= el.x + el.width + 20 / zoom &&
              point.y >= el.y - 12 / zoom &&
              point.y <= el.y + el.height + 12 / zoom
            );
          })
        : undefined;
      const id = target ? workflowBinding(target)!.node.id : null;
      setConnection((value) =>
        value
          ? {
              ...value,
              target: id,
              pointer: point,
              issue: id ? connectionIssue(scope.graph, value.source, id,value.branch) : null,
            }
          : null,
      );
    };
    const up = (event: PointerEvent) => {
      const start = press.current;
      press.current = null;
      if (
        !start ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5
      )
        return;
      if (latest.current?.target) finish(latest.current.target);
      else cancel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [Boolean(connection)]);
  useEffect(() => {
    cancel();
  }, [options.workflowId, options.disabled]);
  return {
    connection,
    cancel,
    finish,
    start: (source: string, event?: React.PointerEvent,branch?:string) => {
      if (options.disabled) return;
      event?.preventDefault();
      event?.stopPropagation();
      press.current = event ? { x: event.clientX, y: event.clientY } : null;
      const output=branch??(workflowOutlets(options.graph.nodes.find(node=>node.id===source))[0]?.value);
      const next = { source, target: null, pointer: null, issue: null,branch:output };
      latest.current = next;
      setConnection(next);
      options.error("");
    },
  };
}
