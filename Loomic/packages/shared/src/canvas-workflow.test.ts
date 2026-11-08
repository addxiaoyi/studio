import { describe, expect, it } from "vitest";
import {
  compileWorkflow,
  connectionIssue,
  validateWorkflow,
  websiteWorkflow,
  workflowFromPlan,
} from "./canvas-workflow.js";
describe("visual workflow contracts", () => {
  const ready = () => {
    const graph = websiteWorkflow();
    graph.nodes[0]!.config = { kind: "url", url: "https://example.com" };
    return graph;
  };
  it("compiles a shuffled graph into a typed executable plan", () => {
    const graph = ready();
    graph.nodes.reverse();
    expect(
      compileWorkflow(graph).steps.map((step) => step.command.executor),
    ).toEqual(["web.capture", "result.deliver"]);
    expect(compileWorkflow(graph).steps[0]?.command).toMatchObject({
      url: "https://example.com",
      record: false,
    });
  });
  it("rejects missing inputs, duplicated links, incompatible nodes and disconnected work", () => {
    const graph = ready();
    graph.edges.pop();
    expect(validateWorkflow(graph).length).toBeGreaterThan(0);
    expect(() => compileWorkflow(graph)).toThrow();
    expect(connectionIssue(ready(), "site", "capture")).toContain("已经连接");
    expect(connectionIssue(ready(), "deliver", "site")).toContain("类型不匹配");
  });
  it("does not allow trimming a screenshot or credential URLs", () => {
    const graph = ready();
    graph.nodes.push({
      id: "trim",
      title: "剪辑",
      position: { x: 0, y: 0 },
      config: { kind: "trim", start: 0, end: 4, aspect: "original" },
    });
    expect(connectionIssue(graph, "capture", "trim")).toContain("类型不匹配");
    graph.nodes[0]!.config = {
      kind: "url",
      url: "https://user:password@example.com",
    };
    expect(() => compileWorkflow(graph)).toThrow("账号密码");
  });
  it("preserves exact recording parameters through AI graph conversion", () => {
    const graph = ready();
    graph.nodes[1]!.config = { kind: "capture", record: true, pageLimit: 2 };
    const plan = compileWorkflow(graph);
    expect(compileWorkflow(workflowFromPlan(plan))).toEqual(plan);
  });
});
it("uses an existing canvas video as an approved trim source", () => {
  const graph = {
    title: "素材剪辑", nodes: [
      { id: "asset", title: "录像", position: { x: 0, y: 0 }, config: { kind: "asset", elementId: "canvas-video", assetId: "ea5aa1ab-10b3-4f12-b89a-963b26b47b86", mediaType: "video" } },
      { id: "trim", title: "剪辑", position: { x: 400, y: 0 }, config: { kind: "trim", start: 0, end: 3, aspect: "original" } },
      { id: "output", title: "输出", position: { x: 800, y: 0 }, config: { kind: "deliver" } },
    ], edges: [{ id: "a", source: "asset", target: "trim" }, { id: "b", source: "trim", target: "output" }],
  };
  const plan = compileWorkflow(graph as never);
  expect(plan.steps[0]!.command).toMatchObject({ executor: "canvas.asset", elementId: "canvas-video", mediaType: "video" });
  expect(plan.steps[1]!.dependsOn).toEqual(["asset"]);
  expect(workflowFromPlan(plan).nodes[0]!.config).toEqual(graph.nodes[0]!.config);
  graph.nodes[0]!.config.mediaType = "image";
  expect(() => compileWorkflow(graph as never)).toThrow(/类型不匹配/);
});
