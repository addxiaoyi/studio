import { expect, it } from "vitest";
import { websiteWorkflow, type WorkflowGraph } from "./canvas-workflow.js";
import {
  portableWorkflow,
  instantiateWorkflow,
  CREATIVE_PROMPTS,
} from "./creative-library.js";

it("saves only selected nodes and their internal connections without retaining private media", () => {
  const graph: WorkflowGraph = {
    title: "参考图剪辑",
    nodes: [
      {
        id: "source",
        title: "私人视频",
        position: { x: 2000, y: 400 },
        config: {
          kind: "asset",
          elementId: "private-canvas-element",
          assetId: "11111111-1111-4111-8111-111111111111",
          mediaType: "video",
        },
      },
      {
        id: "trim",
        title: "裁剪",
        position: { x: 2390, y: 400 },
        config: { kind: "trim", start: 0, end: 3, aspect: "original" },
      },
      {
        id: "deliver",
        title: "输出",
        position: { x: 2780, y: 400 },
        config: { kind: "deliver" },
      },
    ],
    edges: [
      { id: "a", source: "source", target: "trim" },
      { id: "b", source: "trim", target: "deliver" },
    ],
  };
  const template = portableWorkflow(graph, ["source", "trim"]);
  expect(template.nodes).toHaveLength(2);
  expect(template.edges).toHaveLength(1);
  expect(template.nodes[0]!.config).toEqual({
    kind: "asset",
    elementId: "",
    assetId: "",
    mediaType: "video",
  });
  expect(JSON.stringify(template)).not.toContain("private-canvas-element");
  expect(template.nodes[0]!.position).toEqual({ x: 0, y: 0 });
});
it("gives each template instance independent node and edge identities", () => {
  const source = websiteWorkflow();
  const first = instantiateWorkflow(source, "first"),
    second = instantiateWorkflow(source, "second");
  expect(
    new Set([...first.nodes, ...second.nodes].map((node) => node.id)).size,
  ).toBe(6);
  expect(
    first.edges.every(
      (edge) =>
        first.nodes.some((node) => node.id === edge.source) &&
        first.nodes.some((node) => node.id === edge.target),
    ),
  ).toBe(true);
  expect(source.nodes[0]!.id).toBe("site");
});
it("includes reusable creative direction without a provider or credential", () => {
  expect(CREATIVE_PROMPTS.length).toBeGreaterThanOrEqual(4);
  expect(CREATIVE_PROMPTS.every((item) => item.prompt.length > 30)).toBe(true);
});
