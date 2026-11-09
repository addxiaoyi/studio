import {
  connectionIssue,
  workflowNodeSchema,
  type WorkflowGraph,
  type WorkflowNode,
} from "@helstera/shared";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { workflowInputReferences, type WorkflowReference } from "./material-references";
import { workflowCurve, refreshWorkflowCurves } from "./curves";
import { collapsedGroup,groupMovement,workflowGroupBounds,workflowGroupId } from "./groups-scene";

export type SceneElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  version?: number;
  customData?: Record<string, unknown>;
  startBinding?: { elementId: string; focus?: number; gap?: number } | null;
  endBinding?: { elementId: string; focus?: number; gap?: number } | null;
  [key: string]: unknown;
};
export type CanvasState = {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  zoom: { value: number };
  selectedElementIds: Record<string, boolean>;
  offsetLeft?: number;
  offsetTop?: number;
  cursorButton?: "up" | "down";
  selectedElementsAreBeingDragged?: boolean;
  resizingElement?: unknown;
  activeTool?: {type:string};
  contextMenu?: unknown;
};
export type WorkflowCanvasApi = {
  onPointerDown?: ExcalidrawImperativeAPI["onPointerDown"];
  onPointerUp?: ExcalidrawImperativeAPI["onPointerUp"];
  getSceneElements(): readonly SceneElement[];
  getSceneElementsIncludingDeleted(): readonly SceneElement[];
  getAppState(): CanvasState;
  updateScene(scene: {
    elements?: readonly SceneElement[];
    appState?: Partial<CanvasState>;
    captureUpdate: "NEVER" | "IMMEDIATELY";
  }): void;
  onChange(
    listener: (elements: readonly SceneElement[], state: CanvasState) => void,
  ): () => void;
  scrollToContent(
    elements: readonly SceneElement[],
    options: {
      fitToViewport: boolean;
      animate: boolean;
      viewportZoomFactor?: number;
      maxZoom?: number;
    },
  ): void;
  setActiveTool(tool: { type: "arrow" | "selection" }): void;
};
type NodeBinding = {
  workflowId: string;
  node: WorkflowNode;
  state: string;
  issue?: string;
  preview?: NodePreview;
  references?: WorkflowReference[];
};
export type NodePreview = { text?: string; assetId?: string; mediaType?: "image" | "video" };
export const NODE_WIDTH = 300,
  NODE_HEIGHT = 184;
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
export function workflowBinding(element: SceneElement): NodeBinding | null {
  const value = element.customData?.workflow as
    | Partial<NodeBinding>
    | undefined;
  if (!value || typeof value.workflowId !== "string") return null;
  const node = workflowNodeSchema.safeParse(value.node);
  if (
    !node.success ||
    element.id !== nodeElementId(value.workflowId, node.data)
  )
    return null;
  return {
    workflowId: value.workflowId,
    node: node.data,
    state: typeof value.state === "string" ? value.state : "draft",
    ...(typeof value.issue === "string" ? { issue: value.issue } : {}),
    ...(value.preview ? {preview:value.preview} : {}),
    ...(Array.isArray(value.references) ? { references: value.references } : {}),
  };
}
export function nodeElementId(workflowId: string, node: WorkflowNode) {
  return node.config.kind === "asset" && node.config.elementId
    ? node.config.elementId
    : `wf:${workflowId}:${node.id}`;
}
export function workflowWithScenePositions(graph:WorkflowGraph,workflowId:string,scene:readonly SceneElement[]):WorkflowGraph{
  const elements=new Map(scene.filter(el=>!el.isDeleted).map(el=>[el.id,el]));
  return {...graph,nodes:graph.nodes.map(node=>{const element=elements.get(nodeElementId(workflowId,node));return element?{...node,position:{x:element.x,y:element.y}}:node;})};
}
export function upgradeWorkflowCards(scene: readonly SceneElement[]): readonly SceneElement[] {
  let changed=false;
  const upgraded=scene.map(element=>{
    const binding=workflowBinding(element);
    if(element.isDeleted||!binding||binding.node.config.kind==="asset"&&binding.node.config.elementId||element.type==="rectangle"&&element.link===null)return element;
    changed=true;
    return {...element,type:"rectangle",link:null,backgroundColor:"#ffffff",strokeColor:"transparent",roundness:null,version:(element.version??1)+1,versionNonce:Math.floor(Math.random()*2e9),updated:Date.now()};
  });
  return changed?upgraded:scene;
}
const edgeElementId = (workflowId: string, id: string) =>
  `we:${workflowId}:${id}`;
export function adoptWorkflowCopies(
  scene: readonly SceneElement[],
  workflowId: string,
): SceneElement[] {
  const renamed = new Map<string, string>();
  const adopted = scene.map((el) => {
    const binding = el.customData?.workflow as Partial<NodeBinding> | undefined;
    if (
      el.isDeleted ||
      binding?.workflowId !== workflowId ||
      workflowBinding(el)
    )
      return el;
    const parsed = workflowNodeSchema.safeParse(binding.node);
    if (!parsed.success) return el;
    const seed = el.id
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
      .slice(0, 40);
    const {pin:_pin,...copy}=parsed.data;
    const node: WorkflowNode = {
      ...copy,
      id: `copy-${seed}`,
      position: { x: el.x, y: el.y },
      ...(parsed.data.config.kind === "asset"
        ? { config: { ...parsed.data.config, elementId: el.id } }
        : {}),
    };
    const id = nodeElementId(workflowId, node);
    renamed.set(el.id, id);
    return revise(el, {
      ...el,
      id,
      customData: {
        ...el.customData,
        workflow: { workflowId, node, state: "draft" },
      },
    });
  });
  if (!renamed.size) return [...scene];
  return adopted.map((el) => {
    const start = el.startBinding && renamed.get(el.startBinding.elementId),
      end = el.endBinding && renamed.get(el.endBinding.elementId);
    if (!start && !end) return el;
    return revise(el, {
      ...el,
      ...(start
        ? { startBinding: { ...el.startBinding!, elementId: start } }
        : {}),
      ...(end ? { endBinding: { ...el.endBinding!, elementId: end } } : {}),
      customData: { ...el.customData, workflowEdge: undefined },
    });
  });
}
export function materialNode(element: SceneElement): WorkflowNode | null {
  const assetId = element.customData?.assetId;
  if (typeof assetId !== "string" || !uuid.test(assetId) || element.isDeleted)
    return null;
  const mediaType =
    element.type === "image"
      ? "image"
      : element.customData?.isVideo === true
        ? "video"
        : null;
  if (!mediaType) return null;
  // A stable id lets drawing the same connection after undo reuse the same material input.
  let hash = 2166136261;
  for (const character of element.id)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return {
    id: `asset-${(hash >>> 0).toString(36)}`,
    title: String(
      element.customData?.title ??
        (mediaType === "video" ? "画布视频" : "画布图片"),
    ).slice(0, 100),
    position: { x: element.x, y: element.y },
    config: { kind: "asset", elementId: element.id, assetId, mediaType },
  };
}
function baseElement(id: string, type: string): SceneElement {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    angle: 0,
    strokeColor: "#64748b",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    boundElements: null,
    index: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
  };
}
function revise(prior: SceneElement | undefined, next: SceneElement) {
  if (!prior) return next;
  if (JSON.stringify(prior) === JSON.stringify(next)) return prior;
  return {
    ...next,
    version: (prior.version ?? 1) + 1,
    versionNonce: Math.floor(Math.random() * 2_000_000_000),
    updated: Date.now(),
  };
}
export function projectWorkflow(
  scene: readonly SceneElement[],
  workflowId: string,
  graph: WorkflowGraph,
  states: Record<string, string>,
  locked: boolean,
  previews: Record<string, NodePreview> = {},
): SceneElement[] {
  const byId = new Map(scene.map((el) => [el.id, el]));
  const next = new Map<string, SceneElement>();
  for(const group of graph.groups??[]){
    if(!group.nodeIds.some(id=>graph.nodes.some(node=>node.id===id)))continue;
    const id=workflowGroupId(workflowId,group.id),prior=byId.get(id),bounds=workflowGroupBounds(graph,group.nodeIds,scene);
    next.set(id,revise(prior,{...(prior??baseElement(id,"rectangle")),...bounds,...(group.collapsed?{width:280,height:100}:{}),isDeleted:false,locked,backgroundColor:group.collapsed?"#ffffff":"transparent",strokeColor:"#b3bbc8",roughness:0,strokeWidth:1,roundness:{type:3},customData:{workflowGroup:{...group,workflowId,anchor:{x:bounds.x,y:bounds.y}}}}));
  }
  for (const node of graph.nodes) {
    const id = nodeElementId(workflowId, node),
      prior = byId.get(id);
    const boundAsset = node.config.kind === "asset" && Boolean(node.config.elementId);
    if (boundAsset && (!prior || prior.isDeleted&&!prior.customData?.workflowCollapsed)) continue;
    const body = prior ?? baseElement(id, "embeddable");
    const references = workflowInputReferences(graph, node.id, previews);
    const snapshot = { workflowId, node:{...node,position:{...node.position},config:{...node.config}}, state: states[node.id] ?? "draft", references, ...(previews[node.id] ? {preview:previews[node.id]} : {}) };
    next.set(
      id,
      revise(prior, {
        ...body,
        x: node.position.x,
        y: node.position.y,
        isDeleted: !boundAsset&&Boolean(collapsedGroup(graph,node.id)),
        ...(!boundAsset
          ? {
              type: "rectangle",
              link: null,
              backgroundColor: "#ffffff",
              width: Math.max(240, body.width),
              height: Math.max(node.config.kind === "generate" ? 280 : 164, body.height),
              strokeColor: "transparent",
              roundness: null,
            }
          : {}),
        locked,
        customData: { ...body.customData, workflow: snapshot,workflowCollapsed:!boundAsset&&Boolean(collapsedGroup(graph,node.id)) },
      }),
    );
  }
  for (const edge of graph.edges) {
    const sourceNode = graph.nodes.find((node) => node.id === edge.source),
      targetNode = graph.nodes.find((node) => node.id === edge.target);
    if (!sourceNode || !targetNode) continue;
    const sourceGroup=collapsedGroup(graph,sourceNode.id),targetGroup=collapsedGroup(graph,targetNode.id);
    const from = next.get(sourceGroup?workflowGroupId(workflowId,sourceGroup.id):nodeElementId(workflowId, sourceNode)),
      to = next.get(targetGroup?workflowGroupId(workflowId,targetGroup.id):nodeElementId(workflowId, targetNode));
    if (!from || !to) continue;
    const id = edgeElementId(workflowId, edge.id),
      prior = byId.get(id),
      body = prior ?? baseElement(id, "arrow");
    next.set(
      id,
      revise(prior, {
        ...body,
        ...workflowCurve(from, to),
        isDeleted: Boolean(sourceGroup&&sourceGroup.id===targetGroup?.id),
        locked:locked||Boolean(sourceGroup||targetGroup),
        customData: {
          ...body.customData,
          workflowEdge: { workflowId, edgeId: edge.id,source:edge.source,target:edge.target,...(edge.branch?{branch:edge.branch}:{}) },
          workflowCollapsed:Boolean(sourceGroup&&sourceGroup.id===targetGroup?.id),
        },
      }),
    );
  }
  // Excalidraw uses reverse bindings to keep arrows attached during ordinary canvas drags.
  for (const node of graph.nodes) {
    const id = nodeElementId(workflowId, node),
      el = next.get(id);
    if (!el) continue;
    const connected = [...next.values()].filter(
      (edge) =>
        edge.type === "arrow" &&
        (edge.startBinding?.elementId === id ||
          edge.endBinding?.elementId === id),
    );
    const existing = Array.isArray(el.boundElements)
      ? (el.boundElements as Array<{ id: string; type: string }>)
      : [];
    const foreign = existing.filter(
      (binding) => !binding.id.startsWith(`we:${workflowId}:`),
    );
    next.set(
      id,
      revise(byId.get(id), {
        ...el,
        boundElements: [
          ...foreign,
          ...connected.map((edge) => ({ id: edge.id, type: "arrow" })),
        ],
      }),
    );
  }
  const merged = scene.map((el) => {
    const replacement = next.get(el.id);
    if (replacement) {
      next.delete(el.id);
      return replacement;
    }
    if (workflowBinding(el)?.workflowId === workflowId) {
      const oldConfig = workflowBinding(el)?.node.config;
      if (oldConfig?.kind === "asset" && oldConfig.elementId) {
        const { workflow: _removed, ...customData } = el.customData ?? {};
        return revise(el, { ...el, customData, locked: false });
      }
      return revise(el, { ...el, isDeleted: true,customData:{...el.customData,workflowCollapsed:false} });
    }
    const binding = el.customData?.workflowEdge as
      | { workflowId?: string }
      | undefined;
    if (binding?.workflowId === workflowId)
      return revise(el, { ...el, isDeleted: true,customData:{...el.customData,workflowCollapsed:false} });
    if((el.customData?.workflowGroup as {workflowId?:string}|undefined)?.workflowId===workflowId)return el.isDeleted?el:revise(el,{...el,isDeleted:true});
    return el;
  });
  const projected=[...merged,...next.values()];
  projected.sort((a,b)=>Number(Boolean(b.customData?.workflowGroup))-Number(Boolean(a.customData?.workflowGroup)));
  return [...refreshWorkflowCurves(upgradeWorkflowCards(projected))];
}
export function readSceneWorkflow(
  scene: readonly SceneElement[],
  workflowId: string,
  previous: WorkflowGraph,
) {
  const nodes: WorkflowNode[] = [],
    ids = new Map<string, string>(),
    issues: string[] = [],
    consumedArrows: string[] = [];
  const grouping=groupMovement(scene,workflowId,previous);
  for (const el of scene) {
    if (el.isDeleted&&!el.customData?.workflowCollapsed) continue;
    const binding = workflowBinding(el);
    if (binding?.workflowId !== workflowId) continue;
    const position = {
      x: Math.max(-1000000, Math.min(1000000, el.x+(grouping.moved.get(binding.node.id)?.x??0))),
      y: Math.max(-1000000, Math.min(1000000, el.y+(grouping.moved.get(binding.node.id)?.y??0))),
    };
    nodes.push({ ...binding.node, position });
    ids.set(el.id, binding.node.id);
  }
  const graph: WorkflowGraph = { title: previous.title, nodes, edges: [],...(grouping.groups?{groups:grouping.groups.map(group=>({...group,nodeIds:group.nodeIds.filter(id=>nodes.some(node=>node.id===id))})).filter(group=>group.nodeIds.length)}:{}) };
  for (const el of scene) {
    if (el.isDeleted&&!el.customData?.workflowCollapsed || el.type !== "arrow" || el.customData?.workflowResult)
      continue;
    const known=el.customData?.workflowEdge as {workflowId?:string;edgeId?:string;source?:string;target?:string;branch?:"true"|"false"}|undefined;
    const target = ids.get(el.endBinding?.elementId ?? "")??(el.endBinding?.elementId.startsWith(`wfg:${workflowId}:`)?known?.target:undefined);
    if (!target) continue;
    let source = ids.get(el.startBinding?.elementId ?? "")??(el.startBinding?.elementId.startsWith(`wfg:${workflowId}:`)?known?.source:undefined);
    if (!source) {
      const media = scene.find(
        (item) => item.id === el.startBinding?.elementId && !item.isDeleted,
      );
      const node =
        media && !workflowBinding(media) ? materialNode(media) : null;
      if (
        node &&
        !connectionIssue({ ...graph, nodes: [...nodes, node] }, node.id, target)
      ) {
        nodes.push(node);
        ids.set(media!.id, node.id);
        source = node.id;
      }
    }
    if (!source) continue;
    const branch=graph.nodes.find(node=>node.id===source)?.config.kind==="condition"?(known?.branch??previous.edges.find(edge=>edge.id===known?.edgeId)?.branch??"true"):undefined;
    const issue = connectionIssue(graph, source, target,branch,{...previous,nodes});
    if (issue) {
      issues.push(issue);
      continue;
    }
    const binding = el.customData?.workflowEdge as
      | { workflowId?: string; edgeId?: string }
      | undefined;
    const edgeId =
      binding?.workflowId === workflowId && binding.edgeId
        ? binding.edgeId
        : `link-${el.id
            .replace(/[^a-z0-9-]/gi, "")
            .toLowerCase()
            .slice(0, 50)}`;
    graph.edges.push({ id: edgeId, source, target,...(branch?{branch}:{}) });
    if (el.id !== edgeElementId(workflowId, edgeId)) consumedArrows.push(el.id);
  }
  const order = new Map(previous.edges.map((edge,index)=>[edge.id,index]));
  graph.edges.sort((a,b)=>(order.get(a.id)??Number.MAX_SAFE_INTEGER)-(order.get(b.id)??Number.MAX_SAFE_INTEGER));
  return { graph, issues: [...new Set(issues)], consumedArrows };
}

export function placeWorkflow(
  graph: WorkflowGraph,
  scene: readonly SceneElement[],
  state: CanvasState,
): WorkflowGraph {
  if (graph.nodes.some((node) => node.config.kind === "asset" && node.config.elementId)) return graph;
  const visible = scene.filter((el) => !el.isDeleted);
  const right = visible.length
    ? Math.max(...visible.map((el) => el.x + el.width)) + 160
    : -state.scrollX + 100;
  const top = -state.scrollY + 150 / state.zoom.value;
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: {
        x: Math.min(990000, right + node.position.x),
        y: Math.min(990000, top + node.position.y),
      },
    })),
  };
}

export function retainWorkflowLayout(proposed: WorkflowGraph, previous: WorkflowGraph): WorkflowGraph {
  if (!previous.nodes.length) return proposed;
  const origin = { x: Math.min(...previous.nodes.map(node => node.position.x)), y: Math.min(...previous.nodes.map(node => node.position.y)) };
  return { ...proposed, nodes: proposed.nodes.map(node => {
    const saved = previous.nodes.find(item => item.id === node.id);
    return { ...node, position: saved?.position ?? { x: Math.max(-1000000, Math.min(1000000, origin.x + node.position.x)), y: Math.max(-1000000, Math.min(1000000, origin.y + node.position.y)) } };
  }) };
}

export function linkWorkflowResults(
  scene: readonly SceneElement[],
  workflowId: string,
  graph: WorkflowGraph,
  goalId: string,
  elementIds: string[],
  sourceNodeId?:string,
) {
  const output = graph.nodes.find((node) => sourceNodeId ? node.id===sourceNodeId : node.config.kind === "deliver");
  const source =
    output && scene.find((el) => el.id === nodeElementId(workflowId, output));
  if (!source) return [...scene];
  const links: SceneElement[] = [];
  for (const target of scene.filter(
    (el) => elementIds.includes(el.id) && !el.isDeleted && !workflowBinding(el),
  )) {
    const id = `wr:${goalId}:${target.id}`;
    if (scene.some((el) => el.id === id)) continue;
    links.push({
      ...baseElement(id, "arrow"),
      ...workflowCurve(source, target),
      strokeStyle: "dashed",
      customData: { workflowResult: { workflowId, goalId } },
    });
  }
  if (!links.length) return [...scene];
  return [
    ...scene.map((el) => {
      const attached = links.filter(
        (link) =>
          link.startBinding?.elementId === el.id ||
          link.endBinding?.elementId === el.id,
      );
      if (!attached.length) return el;
      return revise(el, {
        ...el,
        boundElements: [
          ...(Array.isArray(el.boundElements) ? el.boundElements : []),
          ...attached.map((link) => ({ id: link.id, type: "arrow" })),
        ],
      });
    }),
    ...links,
  ];
}
