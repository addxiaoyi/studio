import { expect, it } from "vitest";
import { creativeWorkflow } from "./workflow-templates.js";
import {
  compileWorkflow,
  workflowFromPlan,
  connectionIssue,
} from "./canvas-workflow.js";

it("compiles the story, storyboard, shot generation and ordered film delivery chain", () => {
  const graph = creativeWorkflow("film");
  graph.nodes.forEach((node) => {
    if (node.config.kind === "text") node.config.text = "猫咪寻找回家的路";
    if (node.config.kind === "generate") node.config.model = "configured-video";
  });
  const plan = compileWorkflow(graph);
  expect(plan.steps).toHaveLength(10);
  expect(
    plan.steps.find((step) => step.command.executor === "media.compose")
      ?.command,
  ).toMatchObject({ sources: ["video-1", "video-2", "video-3"] });
  expect(workflowFromPlan(plan).nodes).toHaveLength(10);
});
it("requires a chosen model and refuses incompatible creative sources", () => {
  const graph = creativeWorkflow("film");
  expect(() => compileWorkflow(graph)).toThrow("选择生成模型");
  expect(connectionIssue(graph, "story", "compose")).toContain("类型不匹配");
  expect(connectionIssue(graph, "video-1", "author")).toContain("类型不匹配");
});
it("keeps composition order independent of the visual node order", () => {
  const graph = creativeWorkflow("film");
  graph.nodes.forEach((node) => {
    if (node.config.kind === "text") node.config.text = "短片";
    if (node.config.kind === "generate") node.config.model = "configured-video";
  });
  graph.nodes.reverse();
  const compose = compileWorkflow(graph).steps.find(
    (step) => step.command.executor === "media.compose",
  );
  expect(compose?.command).toMatchObject({
    sources: ["video-1", "video-2", "video-3"],
  });
});
