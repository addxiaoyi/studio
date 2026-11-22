import { expect, it } from "vitest";
import type { WorkflowGraph } from "./canvas-workflow.js";
import {
  resolveWorkflowEdits,
  selectWorkflowEdits,
  toggleWorkflowEdit,
  workflowEdits,
} from "./workflow-edit-selection.js";
const position = { x: 0, y: 0 };
const before: WorkflowGraph = {
  title: "流程",
  nodes: [
    {
      id: "source",
      title: "输入",
      position,
      config: { kind: "text", role: "story", text: "hello" },
    },
    { id: "output", title: "输出", position, config: { kind: "deliver" } },
  ],
  edges: [{ id: "a", source: "source", target: "output" }],
};
const after: WorkflowGraph = {
  ...before,
  nodes: [
    ...before.nodes.filter((node) => node.id === "source"),
    {
      id: "trim",
      title: "清理文字",
      position,
      config: {
        kind: "transform",
        operation: "trim",
        search: "",
        replacement: "",
      },
    },
    ...before.nodes.filter((node) => node.id === "output"),
  ],
  edges: [
    { id: "a", source: "source", target: "trim" },
    { id: "b", source: "trim", target: "output" },
  ],
};
it("includes the nodes and connections required by a selected new step", () => {
  const selection = selectWorkflowEdits(before, after, ["node-add:trim"]);
  expect(selection.selectedChanges).toEqual([
    "edge-add:b",
    "edge-change:a",
    "edge-order",
    "node-add:trim",
  ]);
  expect(selection.graph).toEqual(after);
});
it("accepts a node update without unrelated graph metadata", () => {
  const proposal = {
    ...before,
    title: "新名称",
    nodes: before.nodes.map((node) =>
      node.id === "source" ? { ...node, title: "新输入" } : node,
    ),
  };
  const selection = selectWorkflowEdits(before, proposal, [
    "node-change:source",
  ]);
  expect(selection.graph.title).toBe("流程");
  expect(selection.graph.nodes[0]?.title).toBe("新输入");
});
it("makes removals explicit, removes dangling group members and disconnects deleted nodes", () => {
  const base = {
    ...after,
    groups: [
      { id: "g", title: "组", nodeIds: ["source", "trim"], collapsed: true },
    ],
  };
  const proposal = { ...before, groups: base.groups };
  const selection = selectWorkflowEdits(base, proposal, ["node-remove:trim"]);
  expect(selection.destructive.map((edit) => edit.id)).toEqual([
    "node-remove:trim",
  ]);
  expect(selection.graph.edges).toEqual(before.edges);
  expect(selection.graph.groups?.[0]?.nodeIds).toEqual(["source"]);
});
it("rejects forged change identifiers and invalid branch/type changes", () => {
  expect(() =>
    workflowEdits(
      { ...before, nodes: [...before.nodes, ...before.nodes] },
      after,
    ),
  ).toThrow("当前流程包含重复");
  expect(() =>
    selectWorkflowEdits(before, after, ["node-remove:unknown"]),
  ).toThrow("不存在");
  const broken = {
    ...before,
    nodes: before.nodes.map((node) =>
      node.id === "source"
        ? {
            ...node,
            config: {
              kind: "condition",
              match: "all",
              conditions: [{ field: "text", operator: "not_empty", value: "" }],
            },
          }
        : node,
    ),
  } as WorkflowGraph;
  expect(() =>
    selectWorkflowEdits(before, broken, ["node-change:source"]),
  ).toThrow("连线不完整");
});
it("can deselect an addition together with dependent changes", () => {
  const edits = workflowEdits(before, after);
  const requested = toggleWorkflowEdit(
    edits,
    edits.map((edit) => edit.id),
    "node-add:trim",
    false,
  );
  expect(resolveWorkflowEdits(edits, requested)).not.toContain("node-add:trim");
});
