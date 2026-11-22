// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { WorkflowFieldPicker } from "@/components/workflow/field-picker";
import {
  listWorkflowFields,
  workflowFieldSample,
} from "@/components/workflow/upstream-fields";
import type { WorkflowGraph } from "@helstera/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);
const position = { x: 0, y: 0 };
const graph: WorkflowGraph = {
  title: "字段",
  nodes: [
    {
      id: "source",
      title: "JSON 输入",
      position,
      config: { kind: "json", json: '{"score":80,"person":{"name":"Ada"}}' },
    },
    {
      id: "extract",
      title: "提取",
      position,
      config: { kind: "extract", path: "score" },
    },
    { id: "output", title: "输出", position, config: { kind: "deliver" } },
  ],
  edges: [
    { id: "a", source: "source", target: "extract" },
    { id: "b", source: "extract", target: "output" },
  ],
};

it("reads current JSON inputs and gives typed nested paths for IF and extract scopes", () => {
  const sample = workflowFieldSample(graph, "extract");
  expect(sample?.origin).toBe("input");
  expect(listWorkflowFields(sample?.output).fields).toContainEqual({
    path: "json.score",
    type: "数字",
    preview: "80",
  });
  expect(listWorkflowFields(sample?.output?.json).fields).toContainEqual({
    path: "person.name",
    type: "文字",
    preview: "Ada",
  });
});
it("keeps a successful source sample across downstream edits but invalidates changed ancestors", () => {
  const runGraph = structuredClone(graph);
  runGraph.nodes[0] = {
    id: "source",
    title: "生成资料",
    position,
    config: {
      kind: "write",
      mode: "rewrite",
      instruction: "draft",
      shotCount: 1,
    },
  };
  const edited = structuredClone(runGraph);
  edited.nodes = edited.nodes.map((node) =>
    node.id === "extract"
      ? { ...node, config: { kind: "extract", path: "person.name" } }
      : node,
  );
  const outputs = { source: { json: { person: { name: "Ada" } } } };
  expect(
    workflowFieldSample(edited, "extract", outputs, runGraph)?.output,
  ).toEqual(outputs.source);
  edited.nodes[0] = {
    id: "source",
    title: "生成资料",
    position,
    config: {
      kind: "write",
      mode: "rewrite",
      instruction: "changed",
      shotCount: 1,
    },
  };
  expect(
    workflowFieldSample(edited, "extract", outputs, runGraph)?.output,
  ).toBeNull();
});
it("rejects unsafe paths and bounds large array/deep samples", () => {
  const source = JSON.parse(
    '{"safe":1,"__proto__":{"secret":2},"constructor":3}',
  );
  expect(listWorkflowFields(source).fields.map((field) => field.path)).toEqual([
    "safe",
  ]);
  const large = listWorkflowFields({
    items: Array.from({ length: 1000 }, (_, score) => ({ score })),
  });
  expect(large.truncated).toBe(true);
  expect(large.fields.length).toBeLessThanOrEqual(200);
});
it("selects an actual field and exposes a missing-field repair action", async () => {
  const change = vi.fn();
  const locate = vi.fn();
  const sample = workflowFieldSample(graph, "extract");
  render(
    <WorkflowFieldPicker
      sample={sample}
      value="missing"
      label="提取"
      disabled={false}
      jsonOnly
      onChange={change}
      locate={locate}
    />,
  );
  fireEvent.click(screen.getByText("从上游选择提取字段"));
  expect(screen.getByRole("status")).toHaveTextContent(
    "在当前上游样本中不存在",
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "选择提取字段" }));
  await screen.findByRole("listbox", { name: "选择提取字段" });
  await user.keyboard("{End}");
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "person.name · 文字 · Ada" }),
    ).toHaveAttribute("data-highlighted"),
  );
  await user.keyboard("{Enter}");
  await waitFor(() => expect(change).toHaveBeenCalledWith("person.name"));
  fireEvent.click(screen.getByRole("button", { name: "定位上游节点" }));
  expect(locate).toHaveBeenCalledWith("source");
});
