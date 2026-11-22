// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { BranchPreview } from "@/components/workflow/branch-preview";
import { LogicInspector } from "@/components/workflow/logic-inspector";
import type { WorkflowBranchConfig } from "@helstera/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);
const condition: WorkflowBranchConfig = {
  kind: "condition",
  match: "all",
  conditions: [{ field: "json.score", operator: "greater_than", value: "70" }],
};
const routes: WorkflowBranchConfig = {
  kind: "switch",
  mode: "first",
  cases: [
    {
      id: "high",
      title: "高分",
      match: "all",
      conditions: condition.conditions,
    },
    {
      id: "present",
      title: "有评分",
      match: "all",
      conditions: [{ field: "json.score", operator: "not_empty", value: "" }],
    },
  ],
};
function enterSample(text: string) {
  fireEvent.change(
    screen.getByRole("textbox", { name: "上游输出样本（JSON）" }),
    { target: { value: text } },
  );
  fireEvent.click(screen.getByRole("button", { name: "演算条件" }));
}
function openPreview() {
  fireEvent.click(screen.getByText("样本演算"));
}

it("previews IF without changing the node or making a request, even when editing is locked", () => {
  const change = vi.fn();
  const request = vi.spyOn(globalThis, "fetch");
  try {
    render(
      <LogicInspector
        node={{
          id: "check",
          title: "评分检查",
          position: { x: 0, y: 0 },
          config: condition,
        }}
        disabled
        onChange={change}
      />,
    );
    openPreview();
    enterSample('{"json":{"score":80}}');
    expect(screen.getByRole("status")).toHaveTextContent("命中出口：是");
    expect(screen.getByText("json.score").parentElement).toHaveTextContent(
      "80",
    );
    expect(screen.getByText("条件 1 · 满足")).toBeVisible();
    expect(change).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  } finally {
    request.mockRestore();
  }
});
it("keeps malformed samples for correction and links validation to the input", () => {
  render(<BranchPreview config={condition} />);
  openPreview();
  enterSample("bad json");
  const sample = screen.getByRole("textbox", { name: "上游输出样本（JSON）" });
  expect(sample).toHaveValue("bad json");
  expect(sample).toHaveAttribute("aria-invalid", "true");
  expect(sample).toHaveAccessibleDescription(
    expect.stringContaining("有效的 JSON 对象"),
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  enterSample('{"json":{"score":50}}');
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("命中出口：否");
});
it("rejects null, arrays, primitives and oversized samples", () => {
  render(<BranchPreview config={condition} />);
  openPreview();
  for (const text of ["null", "[]", '"text"', "42"]) {
    enterSample(text);
    expect(screen.getByRole("alert")).toHaveTextContent("必须是 JSON 对象");
  }
  enterSample(" ".repeat(24_001));
  expect(screen.getByRole("alert")).toHaveTextContent("最多支持 24000 字");
});
it("provides a single Switch preview with first/all/default routes and missing-field reasons", () => {
  const { rerender } = render(
    <LogicInspector
      node={{
        id: "route",
        title: "分类",
        position: { x: 0, y: 0 },
        config: routes,
      }}
      disabled={false}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getAllByText("样本演算")).toHaveLength(1);
  openPreview();
  enterSample('{"json":{"score":80}}');
  expect(screen.getByRole("status")).toHaveTextContent("命中出口：高分");
  expect(
    screen.getByText("按顺序首个命中后停止，其余出口未演算。"),
  ).toBeVisible();
  rerender(
    <LogicInspector
      node={{
        id: "route",
        title: "分类",
        position: { x: 0, y: 0 },
        config: { ...routes, mode: "all" },
      }}
      disabled={false}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "命中出口：高分、有评分",
  );
  enterSample("{}");
  expect(screen.getByRole("status")).toHaveTextContent("命中出口：默认出口");
  expect(screen.getAllByText(/字段不存在/)).toHaveLength(2);
});
it("clears old results while the sample changes and recalculates when settings change", () => {
  const { rerender } = render(<BranchPreview config={condition} />);
  openPreview();
  enterSample('{"json":{"score":80}}');
  rerender(
    <BranchPreview
      config={{
        ...condition,
        conditions: condition.conditions.map((rule) => ({
          ...rule,
          value: "90",
        })),
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("命中出口：否");
  fireEvent.change(
    screen.getByRole("textbox", { name: "上游输出样本（JSON）" }),
    { target: { value: "{}" } },
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("reports unsafe configuration without marking a valid sample as invalid", () => {
  render(
    <BranchPreview
      config={{
        ...condition,
        conditions: condition.conditions.map((rule) => ({
          ...rule,
          field: "constructor.secret",
        })),
      }}
    />,
  );
  openPreview();
  enterSample("{}");
  expect(screen.getByRole("alert")).toHaveTextContent("字段路径无效");
  expect(
    screen.getByRole("textbox", { name: "上游输出样本（JSON）" }),
  ).toHaveAttribute("aria-invalid", "false");
});
