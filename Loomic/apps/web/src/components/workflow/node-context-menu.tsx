"use client";
import { useEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { ArrowRight, Pencil, Plus, Sparkles } from "lucide-react";
import { WORKFLOW_LABELS } from "@helstera/shared";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { hitWorkflowCard } from "./layer-view";
import {
  workflowBinding,
  type SceneElement,
  type WorkflowCanvasApi,
} from "./scene";

type NodeMenu = { element: SceneElement; x: number; y: number };
export function useWorkflowContextMenu(api: WorkflowCanvasApi | null) {
  const [menu, setMenu] = useState<NodeMenu | null>(null);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-canvas-surface]");
    if (!api || !root) return;
    const open = (
      element: SceneElement,
      x: number,
      y: number,
      event: Event,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      api.updateScene({
        appState: {
          selectedElementIds: { [element.id]: true },
          contextMenu: null,
        },
        captureUpdate: "NEVER",
      });
      setMenu({ element, x, y });
    };
    const context = (event: MouseEvent) => {
      if (
        !(event.target instanceof Element) ||
        (!event.target.matches("canvas") &&
          !event.target.closest("[data-workflow-layer]"))
      )
        return;
      const element = hitWorkflowCard(api, root, event);
      if (element) open(element, event.clientX, event.clientY, event);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.key !== "ContextMenu" &&
        !(event.shiftKey && event.key === "F10")
      )
        return;
      if (
        !(event.target instanceof HTMLElement) ||
        event.target.closest("input,textarea,[contenteditable=true]")
      )
        return;
      const state = api.getAppState();
      const chosen = api
        .getSceneElements()
        .filter((el) => !el.isDeleted && state.selectedElementIds[el.id]);
      const element = chosen[0];
      if (chosen.length !== 1 || !element || !workflowBinding(element)) return;
      const box = root.getBoundingClientRect();
      open(
        element,
        box.left +
          (element.x + state.scrollX + element.width / 2) * state.zoom.value,
        box.top + (element.y + state.scrollY + 36) * state.zoom.value,
        event,
      );
    };
    root.addEventListener("contextmenu", context, true);
    root.addEventListener("keydown", keyboard, true);
    return () => {
      root.removeEventListener("contextmenu", context, true);
      root.removeEventListener("keydown", keyboard, true);
    };
  }, [api]);
  return { menu, close: () => setMenu(null) };
}

export function WorkflowNodeContextMenu({
  menu,
  disabled,
  current,
  close,
  onEdit,
  onAsk,
  onConnect,
  onAdd,
}: {
  menu: NodeMenu;
  disabled: boolean;
  current: boolean;
  close(): void;
  onEdit(workflowId: string, nodeId: string): void;
  onAsk(workflowId: string, nodeId: string): void;
  onConnect(nodeId: string): void;
  onAdd(nodeId: string): void;
}) {
  const acted = useRef(false);
  const binding = workflowBinding(menu.element);
  if (!binding) return null;
  const { node, workflowId } = binding;
  const edit = () => {
    acted.current = true;
    onEdit(workflowId, node.id);
  };
  const ask = () => {
    acted.current = true;
    onAsk(workflowId, node.id);
  };
  const connect = () => {
    onConnect(node.id);
  };
  const add = () => {
    acted.current = true;
    onAdd(node.id);
  };
  return (
    <Menu.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Menu.Portal>
        <Menu.Positioner
          className="workflow-context-positioner"
          positionMethod="fixed"
          align="start"
          sideOffset={6}
          collisionPadding={{ top: document.documentElement.dataset.helsteraDesktop === "true" ? 58 : 12, right: 12, bottom: 12, left: 12 }}
          anchor={{
            getBoundingClientRect: () => new DOMRect(menu.x, menu.y, 0, 0),
          }}
        >
          <Menu.Popup
            className="workflow-context-menu"
            aria-label="节点操作"
            finalFocus={() =>
              acted.current
                ? false
                : document.querySelector<HTMLElement>(
                    "[data-canvas-surface] .excalidraw",
                  )
            }
          >
            <div className="workflow-context-heading">
              <small>{WORKFLOW_LABELS[node.config.kind]}</small>
              <strong>{node.title}</strong>
            </div>
            <DropdownMenuItem className="font-semibold" onClick={edit}>
              <Pencil />
              编辑节点
            </DropdownMenuItem>
            <DropdownMenuItem onClick={ask}>
              <Sparkles />让 AI 修改
            </DropdownMenuItem>
            {node.config.kind !== "deliver" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={disabled || !current}
                  onClick={connect}
                >
                  <ArrowRight />
                  连接下一步
                </DropdownMenuItem>
                <DropdownMenuItem disabled={disabled || !current} onClick={add}>
                  <Plus />
                  添加后续节点
                </DropdownMenuItem>
              </>
            )}
            {!current && (
              <p className="workflow-context-hint">编辑节点后可连接当前流程</p>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
