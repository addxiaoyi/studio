import { expect, it } from "vitest";
import { compileWorkflow, type WorkflowGraph } from "./canvas-workflow.js";
import { goalExecutionPlanSchema } from "./goal-execution.js";

export function switchGraph(): WorkflowGraph {
  const position = { x: 0, y: 0 };
  return {
    title: "多路判断",
    nodes: [
      {
        id: "input",
        title: "输入",
        position,
        config: { kind: "text", role: "story", text: "hello" },
      },
      {
        id: "route",
        title: "路由",
        position,
        config: {
          kind: "switch",
          mode: "first",
          cases: [
            {
              id: "english",
              title: "英文",
              match: "all",
              conditions: [
                { field: "text", operator: "contains", value: "hello" },
              ],
            },
            {
              id: "chinese",
              title: "中文",
              match: "all",
              conditions: [
                { field: "text", operator: "contains", value: "你好" },
              ],
            },
          ],
        },
      },
      ...["english", "chinese", "fallback"].map((id) => ({
        id,
        title: id,
        position,
        config: { kind: "template" as const, template: "{{text}}" },
      })),
      {
        id: "merge",
        title: "合并",
        position,
        config: { kind: "merge", separator: "\n" },
      },
      { id: "output", title: "交付", position, config: { kind: "deliver" } },
    ],
    edges: [
      { id: "input-route", source: "input", target: "route" },
      ...["english", "chinese", "fallback"].flatMap((id) => [
        {
          id: `route-${id}`,
          source: "route",
          target: id,
          branch: id === "fallback" ? "default" : id,
        },
        { id: `${id}-merge`, source: id, target: "merge" },
      ]),
      { id: "deliver", source: "merge", target: "output" },
    ],
  };
}
it("compiles named Switch and default outlets and rejects stale outlet IDs", () => {
  const graph = switchGraph();
  expect(
    compileWorkflow(graph).steps.find((step) => step.id === "fallback")?.when,
  ).toEqual([{ source: "route", branch: "default" }]);
  graph.edges[1]!.branch = "removed";
  expect(() => compileWorkflow(graph)).toThrow(/出口/);
});
it("rejects direct model plans that omit the selected branch",()=>{
  const plan=compileWorkflow(switchGraph());
  delete plan.steps.find(step=>step.id==="fallback")!.when;
  expect(()=>goalExecutionPlanSchema.parse(plan)).toThrow("明确选择出口");
});
it("keeps conditional checks when pinning and rejects duplicate Switch case IDs", () => {
  const graph = switchGraph();
  graph.nodes.find((node) => node.id === "english")!.pin = {
    goalId: "11111111-1111-4111-8111-111111111111",
    nodeId: "english",
  };
  expect(() => compileWorkflow(graph)).toThrow(/分支/);
  delete graph.nodes.find((node) => node.id === "english")!.pin;
  const route = graph.nodes[1]!.config;
  if (route.kind === "switch") route.cases[1]!.id = "english";
  expect(() => compileWorkflow(graph)).toThrow(/重复/);
});
