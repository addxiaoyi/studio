import { describe, expect, it } from "vitest";
import {
  compileWorkflow,
  websiteWorkflow,
  type WorkflowNode,
} from "./canvas-workflow.js";
import { insertWorkflowNode, workflowRunGraph } from "./workflow-editor.js";

const recording = () => {
  const graph = websiteWorkflow(true);
  graph.nodes[0]!.config = { kind: "url", url: "https://example.com" };
  return graph;
};
const trim: WorkflowNode = {
  id: "trim",
  title: "裁剪",
  position: { x: 800, y: 200 },
  config: { kind: "trim", start: 0, end: 5, aspect: "portrait" },
};
describe("workflow editing and partial execution", () => {
  it("inserts a compatible step atomically and preserves downstream input ordering", () => {
    const graph = recording(),
      edge = graph.edges.find((edge) => edge.target === "deliver")!;
    const edited = insertWorkflowNode(graph, edge.id, trim, "inserted");
    expect(edited.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["site", "capture"],
      ["capture", "trim"],
      ["trim", "deliver"],
    ]);
    expect(edited.edges.find((edge) => edge.target === "deliver")?.id).toBe(
      edge.id,
    );
    expect(graph.nodes).toHaveLength(3);
    expect(compileWorkflow(edited).steps.map((step) => step.id)).toEqual([
      "capture",
      "trim",
      "deliver",
    ]);
  });
  it("rejects an incompatible insertion without changing either connection", () => {
    const graph = recording(),
      original = structuredClone(graph);
    expect(() =>
      insertWorkflowNode(graph, graph.edges[0]!.id, trim, "inserted"),
    ).toThrow(/类型/);
    expect(graph).toEqual(original);
    expect(() =>
      insertWorkflowNode(graph, "missing", trim, "inserted"),
    ).toThrow(/连线/);
  });
  it("runs only the chosen ancestors and delivers their result without changing the saved graph", () => {
    const graph = recording();
    graph.nodes.push({
      ...trim,
      config: { ...trim.config, end: 0 } as WorkflowNode["config"],
    });
    const original = structuredClone(graph),
      scoped = workflowRunGraph(graph, "capture");
    expect(scoped.nodes.map((node) => node.id)).toEqual([
      "site",
      "capture",
      "preview-output",
    ]);
    expect(
      compileWorkflow(scoped).steps.map((step) => step.command.executor),
    ).toEqual(["web.capture", "result.deliver"]);
    expect(graph).toEqual(original);
    expect(() => compileWorkflow(graph)).toThrow();
  });
  it("rejects unknown targets, source-only nodes and invalid ancestor parameters", () => {
    const graph = recording();
    expect(() => workflowRunGraph(graph, "missing")).toThrow(/不存在/);
    expect(() => workflowRunGraph(graph, "site")).toThrow(/下游/);
    graph.nodes[0]!.config = {
      kind: "url",
      url: "https://name:secret@example.com",
    };
    expect(() => compileWorkflow(workflowRunGraph(graph, "capture"))).toThrow(
      /账号密码/,
    );
  });
});
