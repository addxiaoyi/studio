"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WORKFLOW_LABELS,
  compileWorkflow,
  connectionIssue,
  layoutWorkflow,
  validateWorkflow,
  type WorkflowNode,
  type AgentGoal,
} from "@helstera/shared";
import { useAuth } from "@/lib/auth-context";
import { fetchWorkflowRuns } from "@/lib/canvas-workflow-api";
import { useCanvasWorkflow } from "./use-workflow";
import { useWorkflowRun } from "./run-panel";
import {
  materialNode,
  linkWorkflowResults,
  type WorkflowCanvasApi,
} from "./scene";
import { useCanvasWorkflowScene } from "./use-canvas-scene";
export type CanvasWorkflowProps = {
  token: string;
  canvasId: string;
  sessionId?: string | undefined;
  initialId?: string | undefined;
  api: WorkflowCanvasApi | null;
  open: boolean;
  onOpen(): void;
  onClose(): void;
  onCanvasSync(): void | Promise<void>;
  saveCanvas(): Promise<void>;
};
export const workflowConfigs = {
  url: { kind: "url", url: "" },
  search: { kind: "search", query: "" },
  capture: { kind: "capture", record: false, pageLimit: 1 },
  trim: { kind: "trim", start: 0, end: 5, aspect: "original" },
  deliver: { kind: "deliver" },
} satisfies Record<string, WorkflowNode["config"]>;
export function useWorkflowController({
  token,
  canvasId,
  sessionId,
  initialId,
  api,
  open,
  onOpen,
  onCanvasSync,
  saveCanvas,
}: CanvasWorkflowProps) {
  const { session } = useAuth();
  const flow = useCanvasWorkflow(
    token,
    canvasId,
    session?.user.id ?? "",
    initialId,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"nodes" | "ai" | "runs">("nodes");
  const [confirmRun, setConfirmRun] = useState(false),
    [saving, setSaving] = useState(false);
  const [materials, setMaterials] = useState<WorkflowNode[]>([]);
  const [history, setHistory] = useState<
    Awaited<ReturnType<typeof fetchWorkflowRuns>>
  >([]);
  const completedScope = useRef({
    api,
    graph: flow.graph,
    workflowId: flow.selected?.id,
    onCanvasSync,
  });
  completedScope.current = {
    api,
    graph: flow.graph,
    workflowId: flow.selected?.id,
    onCanvasSync,
  };
  const completed = useCallback(async (goal: AgentGoal) => {
    const scope = completedScope.current;
    await scope.onCanvasSync();
    if (
      scope.api &&
      scope.workflowId &&
      Array.isArray(goal.result?.canvasElementIds)
    ) {
      const ids = goal.result.canvasElementIds.filter(
        (id): id is string => typeof id === "string",
      );
      scope.api.updateScene({
        elements: linkWorkflowResults(
          scope.api.getSceneElementsIncludingDeleted(),
          scope.workflowId,
          scope.graph,
          goal.id,
          ids,
        ),
        captureUpdate: "NEVER",
      });
    }
  }, []);
  const run = useWorkflowRun(token, flow.goalId, completed);
  const active = Boolean(
    run.goal && !["completed", "failed", "canceled"].includes(run.goal.status),
  );
  const locked = flow.busy || active || saving;
  const currentRun =
    !flow.dirty &&
    history.find((item) => item.goalId === flow.goalId)?.revision ===
      flow.selected?.revision;
  const states = useMemo(
    () =>
      Object.fromEntries(
        flow.graph.nodes.map((node) => [
          node.id,
          currentRun
            ? (run.goal?.executionSteps?.find((step) => step.stepId === node.id)
                ?.state ?? (node.config.kind === "url" ? "succeeded" : "draft"))
            : "draft",
        ]),
      ),
    [flow.graph, run.goal, currentRun],
  );
  const issues = useMemo(() => validateWorkflow(flow.graph), [flow.graph]);
  const selected = flow.graph.nodes.find((node) => node.id === selectedId);
  const selectNode = (workflowId: string, nodeId: string) => {
    if (workflowId !== flow.selected?.id) {
      if (flow.dirty) {
        flow.setError("先保存当前流程，再编辑另一组节点。");
        return;
      }
      const document = flow.documents.find((item) => item.id === workflowId);
      if (!document) return;
      flow.select(document);
    }
    setSelectedId(nodeId);
    setTab("nodes");
    if (!open) onOpen();
  };
  const scene = useCanvasWorkflowScene({
    api,
    document: flow.selected,
    graph: flow.graph,
    states,
    locked,
    open,
    edit: flow.edit,
    select: selectNode,
    error: flow.setError,
  });
  const materialSignature = useRef("");
  useEffect(() => {
    if (!api) return;
    const inspect = () => {
      const selected = api.getAppState().selectedElementIds;
      const media = api
        .getSceneElements()
        .filter((el) => selected[el.id])
        .map(materialNode)
        .filter((node): node is WorkflowNode => Boolean(node));
      const signature = JSON.stringify(media);
      if (signature !== materialSignature.current) {
        materialSignature.current = signature;
        setMaterials(media);
      }
    };
    inspect();
    return api.onChange(inspect);
  }, [api]);
  useEffect(() => {
    if (!flow.selected) {
      setHistory([]);
      return;
    }
    let alive = true;
    void fetchWorkflowRuns(token, canvasId, flow.selected.id)
      .then((rows) => {
        if (alive) setHistory(rows);
      })
      .catch((cause) => {
        if (alive) flow.setError(cause.message);
      });
    return () => {
      alive = false;
    };
  }, [token, canvasId, flow.selected?.id, flow.goalId, run.goal?.status]);
  const refreshRun = useCallback(() => run.refresh(), [run.refresh]);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveCanvas();
      await flow.save();
    } catch (cause) {
      flow.setError(
        cause instanceof Error ? cause.message : "画布保存失败，请重试。",
      );
    } finally {
      setSaving(false);
    }
  };
  const connect = (source: string, target: string) => {
    const issue = connectionIssue(flow.graph, source, target);
    if (issue) {
      flow.setError(issue);
      return;
    }
    flow.edit({
      ...flow.graph,
      edges: [
        ...flow.graph.edges,
        { id: `edge-${crypto.randomUUID()}`, source, target },
      ],
    });
  };
  const addNode = (kind: string) => {
    if (!flow.selected || locked || !(kind in workflowConfigs)) return;
    const config = workflowConfigs[kind as keyof typeof workflowConfigs];
    const anchor = selected ?? flow.graph.nodes.at(-1);
    const node: WorkflowNode = {
      id: `node-${crypto.randomUUID()}`,
      title: WORKFLOW_LABELS[config.kind],
      config: structuredClone(config),
      position: {
        x: Math.min(9600, (anchor?.position.x ?? 0) + 390),
        y: anchor?.position.y ?? 0,
      },
    };
    const graph = { ...flow.graph, nodes: [...flow.graph.nodes, node] };
    if (anchor && !connectionIssue(graph, anchor.id, node.id))
      graph.edges = [
        ...graph.edges,
        {
          id: `edge-${crypto.randomUUID()}`,
          source: anchor.id,
          target: node.id,
        },
      ];
    flow.edit(graph);
    setSelectedId(node.id);
    setTab("nodes");
  };
  const importMaterials = () => {
    if (!materials.length || locked) return;
    if (!flow.selected) {
      const first = materials[0]!;
      const output: WorkflowNode = {
        id: "deliver",
        title: "保存素材与结果",
        position: { x: first.position.x + 390, y: first.position.y },
        config: { kind: "deliver" },
      };
      void flow.create(false, {
        title: "画布素材流程",
        nodes: [...materials, output],
        edges: materials.map((node, i) => ({
          id: `input-${i}`,
          source: node.id,
          target: output.id,
        })),
      });
      return;
    }
    const fresh = materials.filter(
      (node) => !flow.graph.nodes.some((existing) => existing.id === node.id),
    );
    if (!fresh.length) {
      flow.setError("所选素材已经在当前流程中。");
      return;
    }
    if (flow.graph.nodes.length + fresh.length > 24) {
      flow.setError("单个流程最多24个节点，请减少所选素材。");
      return;
    }
    flow.edit({ ...flow.graph, nodes: [...flow.graph.nodes, ...fresh] });
    setSelectedId(fresh[0]!.id);
    setTab("nodes");
  };
  const arrange = () => {
    try {
      const positioned = layoutWorkflow(flow.graph),
        anchor = flow.graph.nodes[0]?.position ?? { x: 0, y: 0 };
      flow.edit({
        ...positioned,
        nodes: positioned.nodes.map((node) => ({
          ...node,
          position: {
            x: Math.min(9800, node.position.x + anchor.x),
            y: Math.min(9800, node.position.y + anchor.y),
          },
        })),
      });
      setTimeout(() => scene.focus(), 0);
    } catch (cause) {
      flow.setError(cause instanceof Error ? cause.message : "节点连线有误。");
    }
  };
  const locateResult = () => {
    const ids = run.goal?.result?.canvasElementIds;
    if (Array.isArray(ids))
      scene.locateResults(
        ids.filter((id): id is string => typeof id === "string"),
      );
  };
  let plan: ReturnType<typeof compileWorkflow> | null = null;
  try {
    plan = compileWorkflow(flow.graph);
  } catch {
    /* Node issues remain visible before execution. */
  }
  async function startRun() {
    setConfirmRun(false);
    try {
      await saveCanvas();
      await flow.start(sessionId);
      setTab("runs");
    } catch (cause) {
      flow.setError(cause instanceof Error ? cause.message : "画布保存失败。");
    }
  }
  const proposal = flow.proposal;
  return {
    flow,
    run,
    active,
    states,
    issues,
    selectedId,
    setSelectedId,
    tab,
    setTab,
    confirmRun,
    setConfirmRun,
    saving,
    materials,
    history,
    locked,
    selected,
    scene,
    save,
    connect,
    addNode,
    importMaterials,
    arrange,
    locateResult,
    plan,
    proposal,
    startRun,
    refreshRun,
  };
}
