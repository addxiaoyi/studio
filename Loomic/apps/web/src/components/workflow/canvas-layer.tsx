"use client";
import { createPortal } from "react-dom";
import { Pencil, Plus, X, Unplug,ChevronDown,ChevronRight,Layers } from "lucide-react";
import {
  connectionIssue,
  validateWorkflow,
  type WorkflowGraph,
} from "@helstera/shared";
import { WorkflowCanvasNode } from "./canvas-node";
import { workflowBinding, type WorkflowCanvasApi } from "./scene";
import { useNodeConnect } from "./use-node-connect";
import "./node-interactions.css";
import { useWorkflowLayerView, useWorkflowNodeEdit } from "./layer-view";
import { useWorkflowContextMenu, WorkflowNodeContextMenu } from "./node-context-menu";

type Props = {
  api: WorkflowCanvasApi | null;
  token: string;
  workflowId?: string | undefined;
  graph: WorkflowGraph;
  disabled: boolean;
  onEdit(workflowId: string, nodeId: string): void;
  onAsk(workflowId: string, nodeId: string): void;
  onConnect(source: string, target: string,branch?:"true"|"false"): void;
  onDisconnect(edgeId: string): void;
  onInsert(edgeId:string):void;
  onAdd(nodeId: string): void;
  onError(message: string): void;
  onToggleGroup(id:string):void;
};
export function WorkflowCanvasLayer(props: Props) {
  const { view, hover } = useWorkflowLayerView(props.api);
  useWorkflowNodeEdit(props.api, props.onEdit);
  const context = useWorkflowContextMenu(props.api);
  const connect = useNodeConnect({
    api: props.api,
    workflowId: props.workflowId,
    graph: props.graph,
    disabled: props.disabled,
    connect: props.onConnect,
    error: props.onError,
  });
  if (!view) return null;
  const { state, elements, root } = view,
    zoom = state.zoom.value;
  const issues = validateWorkflow(props.graph);
  const nodes = elements.filter((el) => !el.isDeleted && workflowBinding(el));
  const selectedIds = Object.keys(state.selectedElementIds).filter(
    (id) => state.selectedElementIds[id],
  );
  const selectedWire =
    selectedIds.length === 1
      ? elements.find(
          (el) => el.id === selectedIds[0] && el.customData?.workflowEdge,
        )
      : undefined;
  const wireBinding = selectedWire?.customData?.workflowEdge as
    | { workflowId: string; edgeId: string }
    | undefined;
  const wire =
    wireBinding && wireBinding.workflowId === props.workflowId
      ? props.graph.edges.find((edge) => edge.id === wireBinding.edgeId)
      : undefined;
  const point = (x: number, y: number) => ({
    x: (x + state.scrollX) * zoom,
    y: (y + state.scrollY) * zoom,
  });
  const source =
    connect.connection &&
    nodes.find(
      (el) =>
        workflowBinding(el)?.node.id === connect.connection?.source &&
        workflowBinding(el)?.workflowId === props.workflowId,
    );
  const start = source
    ? point(source.x + source.width, source.y + source.height / 2)
    : null;
  const end = connect.connection?.pointer
    ? point(connect.connection.pointer.x, connect.connection.pointer.y)
    : start
      ? { x: start.x + 90, y: start.y }
      : null;
  return createPortal(
    <div className="workflow-canvas-layer" data-workflow-layer>
      {elements.filter(el=>Boolean(props.workflowId)&&!el.isDeleted&&(el.customData?.workflowGroup as {workflowId?:string}|undefined)?.workflowId===props.workflowId).map(el=>{const group=el.customData!.workflowGroup as {id:string;title:string;note?:string;nodeIds:string[];collapsed:boolean};const at=point(el.x,el.y);return <div key={el.id} className={`workflow-group-overlay ${group.collapsed?"is-collapsed":""}`} style={{transform:`translate(${at.x}px,${at.y}px) scale(${zoom})`,width:el.width,height:group.collapsed?el.height:44}} data-workflow-group={group.id}><header><Layers size={15}/><strong>{group.title}</strong><small>{group.nodeIds.length} 节点</small><button type="button" disabled={props.disabled} aria-label={`${group.collapsed?"展开":"折叠"}画布分组${group.title}`} onPointerDown={event=>event.stopPropagation()} onClick={()=>props.onToggleGroup(group.id)}>{group.collapsed?<ChevronRight size={16}/>:<ChevronDown size={16}/>}</button></header>{group.collapsed&&<p>{group.note||"展开查看组内节点"}</p>}</div>;})}
      {context.menu && <WorkflowNodeContextMenu menu={context.menu} close={context.close}
        current={workflowBinding(context.menu.element)?.workflowId === props.workflowId} disabled={props.disabled}
        onEdit={props.onEdit} onAsk={props.onAsk} onConnect={connect.start} onAdd={props.onAdd} />}
      <svg className="workflow-wire-targets" aria-hidden="true">
        {elements
          .filter(
            (el) =>
              !el.isDeleted &&
              Boolean(props.workflowId) &&
              el.type === "arrow" &&
              (
                el.customData?.workflowEdge as
                  | { workflowId?: string }
                  | undefined
              )?.workflowId === props.workflowId,
          )
          .map((el) => {
            const points = el.points as number[][] | undefined;
            if (!points?.length) return null;
            const path = points
              .map((p, i) => {
                const at = point(el.x + p[0]!, el.y + p[1]!);
                return `${i ? "L" : "M"}${at.x},${at.y}`;
              })
              .join(" ");
            return (
              <path
                key={el.id}
                d={path}
                className="workflow-wire-hit"
                data-workflow-edge={(el.customData?.workflowEdge as {edgeId:string}).edgeId}
                data-active={Boolean(state.selectedElementIds[el.id] || state.selectedElementIds[el.startBinding?.elementId ?? ""] || state.selectedElementIds[el.endBinding?.elementId ?? ""])}
                style={{
                  pointerEvents:
                    state.activeTool?.type === "selection" ? "stroke" : "none",
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 || event.altKey || event.shiftKey)
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  root
                    .querySelector<HTMLElement>(".excalidraw")
                    ?.focus({ preventScroll: true });
                  props.api?.updateScene({
                    appState: { selectedElementIds: { [el.id]: true } },
                    captureUpdate: "NEVER",
                  });
                }}
              />
            );
          })}
        {start && end && (
          <path
            className="workflow-connection-preview"
            d={`M${start.x},${start.y} C${start.x + 70},${start.y} ${end.x - 70},${end.y} ${end.x},${end.y}`}
          />
        )}
      </svg>
      {nodes.map((element) => {
        const binding = workflowBinding(element)!;
        if (
          binding.node.config.kind === "asset" &&
          binding.node.config.elementId
        )
          return null;
        const at = point(element.x, element.y);
        if (
          at.x + element.width * zoom < 0 ||
          at.y + element.height * zoom < 0 ||
          at.x > state.width ||
          at.y > state.height
        )
          return null;
        const current = binding.workflowId === props.workflowId,
          selected = Boolean(state.selectedElementIds[element.id]);
        const show =
          current &&
          (hover === element.id || selected || Boolean(connect.connection)) &&
          !state.selectedElementsAreBeingDragged && !state.contextMenu && !context.menu &&
          state.activeTool?.type === "selection";
        const issue = connect.connection
          ? connectionIssue(
              props.graph,
              connect.connection.source,
              binding.node.id,
              connect.connection.branch,
            )
          : null;
        const valid = connect.connection && !issue;
        const edit = () => props.onEdit(binding.workflowId, binding.node.id);
        const nodeIssue = current
          ? issues.find((issue) => issue.nodeId === binding.node.id)?.message
          : undefined;
        return (
          <div
            key={element.id}
            className="workflow-node-position"
            style={
              {
                transform: `translate(${at.x}px,${at.y}px) scale(${zoom})`,
                width: element.width,
                height: element.height,
                "--workflow-port-size": `${Math.max(32, 28 / zoom)}px`,
              } as React.CSSProperties
            }
          >
            <div
              className="workflow-node-rotation"
              style={{ transform: `rotate(${Number(element.angle) || 0}rad)` }}
            >
              {element.type === "rectangle" && (
                <WorkflowCanvasNode
                  element={element}
                  accessToken={props.token}
                  selected={selected}
                  connecting={Boolean(valid)}
                  issue={nodeIssue}
                  outputs={current ? props.graph.edges.filter(edge=>edge.source===binding.node.id).length : undefined}
                />
              )}
              {show && (
                <>
                  <button
                    type="button"
                    className={`workflow-input-port ${valid ? "is-compatible" : ""}`}
                    aria-label={`连接到${binding.node.title}`}
                    title={
                      connect.connection
                        ? (issue ?? "连接到此节点")
                        : "输入连接"
                    }
                    aria-disabled={
                      !connect.connection || Boolean(issue) || props.disabled
                    }
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => connect.finish(binding.node.id)}
                  >
                    <span />
                  </button>
                  {binding.node.config.kind === "condition" && (["true","false"] as const).map(branch=><button key={branch} type="button" className={`workflow-output-port is-branch is-${branch}`} disabled={props.disabled} aria-label={`从${binding.node.title}${branch==="true"?"是":"否"}分支连接`} onPointerDown={event=>connect.start(binding.node.id,event,branch)} onClick={event=>{if(event.detail===0)connect.start(binding.node.id,undefined,branch);}}><small>{branch==="true"?"是":"否"}</small><span/></button>)}
                  {!["deliver","condition"].includes(binding.node.config.kind) && (
                    <button
                      type="button"
                      className="workflow-output-port"
                      disabled={props.disabled}
                      aria-label={`从${binding.node.title}连接`}
                      title="拖到目标节点，或点击后选择输入点"
                      onPointerDown={(event) =>
                        connect.start(binding.node.id, event)
                      }
                      onClick={(event) => {
                        if (event.detail === 0) connect.start(binding.node.id);
                      }}
                    >
                      <span />
                    </button>
                  )}
                  <div className="workflow-node-tools">
                    <button
                      type="button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={edit}
                      aria-label={`编辑${binding.node.title}`}
                    >
                      <Pencil size={14} />
                      <span>编辑</span>
                    </button>
                    {binding.node.config.kind !== "deliver" && (
                      <button
                        type="button"
                        disabled={props.disabled}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => props.onAdd(binding.node.id)}
                        aria-label={`在${binding.node.title}后添加节点`}
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
      {connect.connection && (
        <div className="workflow-connect-notice" role="status">
          <span>
            {connect.connection.issue ??
              "拖到目标节点，或点击亮起的输入点连接 · Esc 取消"}
          </span>
          <button type="button" onClick={connect.cancel} aria-label="取消连线">
            <X size={15} />
          </button>
        </div>
      )}
      {selectedWire && wire && (
        <div
          className="workflow-wire-menu"
          style={{
            left: Math.max(
              80,
              Math.min(
                state.width - 260,
                point(selectedWire.x, selectedWire.y).x,
              ),
            ),
            top: Math.max(
              70,
              Math.min(
                state.height - 70,
                point(selectedWire.x, selectedWire.y).y - 45,
              ),
            ),
          }}
          role="group"
          aria-label="连线操作"
        >
          <span>
            {props.graph.nodes.find((node) => node.id === wire.source)?.title} →{" "}
            {props.graph.nodes.find((node) => node.id === wire.target)?.title}
          </span>
          <button
            type="button"
            disabled={props.disabled}
            onClick={()=>props.onInsert(wire.id)}
          ><Plus size={14}/>插入节点</button>
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => props.onDisconnect(wire.id)}
          >
            <Unplug size={14} />
            断开
          </button>
        </div>
      )}
    </div>,
    root,
  );
}
