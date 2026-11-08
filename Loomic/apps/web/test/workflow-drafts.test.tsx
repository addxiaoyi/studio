import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { websiteWorkflow, type WorkflowDocument } from "@helstera/shared";
import { useCanvasWorkflow } from "@/components/workflow/use-workflow";
import {nextNodePosition,workflowGraphKey} from "@/components/workflow/graph-state";
const api = vi.hoisted(() => ({
  listCanvasWorkflows: vi.fn(),
  saveCanvasWorkflow: vi.fn(),
  runCanvasWorkflow: vi.fn(),
}));
vi.mock("@/lib/canvas-workflow-api", () => ({
  ...api,
  createCanvasWorkflow: vi.fn(),
  planCanvasWorkflow: vi.fn(),
}));
const doc: WorkflowDocument = {
  id: "2313f69d-4cd5-4d3b-963e-10dc35174bbd",
  canvasId: "1e6f16e1-a87d-48a7-82aa-7d8602fc312b",
  revision: 1,
  graph: websiteWorkflow(),
  activeGoalId: null,
  updatedAt: "2026-11-08",
};
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
it("clears a stale local draft after undo returns to the saved workflow",async()=>{
  api.listCanvasWorkflows.mockResolvedValue({workflows:[doc],executionEnabled:true});
  const hook=renderHook(()=>useCanvasWorkflow("token",doc.canvasId,"user"));await waitFor(()=>expect(hook.result.current.selected).toBeTruthy());
  act(()=>hook.result.current.edit({...doc.graph,title:"Temporary drag"}));
  expect(localStorage.getItem(`loomic:workflow:user:${doc.id}`)).not.toBeNull();
  act(()=>hook.result.current.undoEdit());
  expect(hook.result.current.dirty).toBe(false);
  expect(localStorage.getItem(`loomic:workflow:user:${doc.id}`)).toBeNull();
});
it("places new steps below occupied space and preserves ordered composition inputs",()=>{
  expect(nextNodePosition({x:0,y:0},[{x:390,y:0,width:300,height:184}],184)).toEqual({x:390,y:254});
  expect(workflowGraphKey(doc.graph)).not.toBe(workflowGraphKey({...doc.graph,edges:[...doc.graph.edges].reverse()}));
});
it("ignores equivalent field ordering instead of adding a phantom undo checkpoint",async()=>{
  api.listCanvasWorkflows.mockResolvedValue({workflows:[doc],executionEnabled:true});
  const hook=renderHook(()=>useCanvasWorkflow("token",doc.canvasId,"user"));await waitFor(()=>expect(hook.result.current.selected).toBeTruthy());
  act(()=>hook.result.current.edit({...doc.graph,nodes:doc.graph.nodes.map(node=>({config:node.config,position:node.position,title:node.title,id:node.id}))}));
  expect(hook.result.current.undo).toHaveLength(0);expect(hook.result.current.dirty).toBe(false);
});
it("returns save failure without claiming success or starting a run", async () => {
  api.listCanvasWorkflows.mockResolvedValue({
    workflows: [doc],
    executionEnabled: true,
  });
  api.saveCanvasWorkflow.mockRejectedValue(new Error("版本冲突"));
  const hook = renderHook(() =>
    useCanvasWorkflow("token", doc.canvasId, "user"),
  );
  await waitFor(() => expect(hook.result.current.selected?.id).toBe(doc.id));
  act(() => hook.result.current.edit({ ...doc.graph, title: "未保存的内容" }));
  let saved: unknown;
  await act(async () => {
    saved = await hook.result.current.save();
  });
  expect(saved).toBeNull();
  expect(hook.result.current.dirty).toBe(true);
  expect(hook.result.current.error).toBe("版本冲突");
  expect(api.runCanvasWorkflow).not.toHaveBeenCalled();
});
it("keeps edits made while a save is in flight recoverable", async () => {
  api.listCanvasWorkflows.mockResolvedValue({
    workflows: [doc],
    executionEnabled: true,
  });
  let finish!: (document: WorkflowDocument) => void;
  api.saveCanvasWorkflow.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const hook = renderHook(() =>
    useCanvasWorkflow("token", doc.canvasId, "user"),
  );
  await waitFor(() => expect(hook.result.current.selected).toBeTruthy());
  const first = { ...doc.graph, title: "版本一" };
  act(() => hook.result.current.edit(first));
  let saving: Promise<unknown>;
  act(() => {
    saving = hook.result.current.save();
  });
  act(() => hook.result.current.edit({ ...first, title: "后续编辑" }));
  await act(async () => {
    finish({ ...doc, revision: 2, graph: first });
    await saving;
  });
  expect(hook.result.current.graph.title).toBe("后续编辑");
  expect(hook.result.current.dirty).toBe(true);
  expect(
    JSON.parse(localStorage.getItem(`loomic:workflow:user:${doc.id}`)!).title,
  ).toBe("后续编辑");
});
