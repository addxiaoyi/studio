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
