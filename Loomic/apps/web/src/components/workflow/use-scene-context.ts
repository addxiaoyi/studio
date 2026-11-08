"use client";
import { useEffect, useState } from "react";
import { workflowBinding, type WorkflowCanvasApi } from "./scene";
export type CanvasReference = {
  id: string;
  title: string;
  kind: "text" | "image" | "video";
};
export function useSceneContext(
  api: WorkflowCanvasApi | null,
  workflowId?: string,
) {
  const [selection, setSelection] = useState<{
    nodes: string[];
    references: CanvasReference[];
  }>({ nodes: [], references: [] });
  useEffect(() => {
    if (!api) return;
    let signature = "";
    const update = () => {
      const selected = api.getAppState().selectedElementIds ?? {},
        nodes: string[] = [],
        references: CanvasReference[] = [];
      for (const element of api.getSceneElements()) {
        if (!selected[element.id]) continue;
        const binding = workflowBinding(element);
        if (binding && binding.workflowId === workflowId)
          nodes.push(binding.node.id);
        if (element.type === "text" && typeof element.text === "string")
          references.push({
            id: element.id,
            title: element.text.slice(0, 48),
            kind: "text",
          });
        else if (
          typeof element.customData?.assetId === "string" &&
          (element.type === "image" || element.customData.isVideo === true)
        )
          references.push({
            id: element.id,
            title: String(element.customData.title ?? "画布素材").slice(0, 48),
            kind: element.type === "image" ? "image" : "video",
          });
      }
      const next = JSON.stringify({ nodes, references });
      if (next === signature) return;
      signature = next;
      setSelection({ nodes, references });
    };
    update();
    return api.onChange(update);
  }, [api, workflowId]);
  return selection;
}
