// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WorkflowGraph } from "@helstera/shared";
import {
  WorkflowNavigation,
  workflowMapBounds,
} from "@/components/workflow/navigation-map";
afterEach(cleanup);
const graph: WorkflowGraph = {
  title: "大型流程",
  nodes: Array.from({ length: 48 }, (_, index) => ({
    id: `node-${index}`,
    title: `步骤 ${index + 1}`,
    note: index === 47 ? "待发布" : undefined,
    position: {
      x: (index % 8) * 400 - 1500,
      y: Math.floor(index / 8) * 260 - 600,
    },
    config: { kind: "text", role: "story", text: "test" },
  })),
  edges: [],
  groups: [
    {
      id: "group",
      title: "发布组",
      nodeIds: ["node-46", "node-47"],
      collapsed: true,
    },
  ],
};
it("includes negative coordinates and locates collapsed groups with keyboard", () => {
  const locate = vi.fn();
  render(<WorkflowNavigation graph={graph} onLocate={locate} />);
  fireEvent.click(screen.getByText("缩略导航"));
  fireEvent.keyDown(
    screen.getByRole("button", { name: "缩略定位分组发布组" }),
    { key: "Enter" },
  );
  expect(locate).toHaveBeenCalledWith(["node-46", "node-47"]);
  const bounds = workflowMapBounds(graph);
  expect(bounds.x).toBeLessThan(-1500);
  expect(bounds.y).toBeLessThan(-600);
  expect(bounds.width).toBeGreaterThan(3000);
});
it("searches notes and moves the view without opening node settings", () => {
  const locate = vi.fn();
  render(<WorkflowNavigation graph={graph} onLocate={locate} />);
  fireEvent.click(screen.getByText("缩略导航"));
  fireEvent.change(screen.getByRole("textbox", { name: "查找节点或备注" }), {
    target: { value: "待发布" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^步骤 48$/ }));
  expect(locate).toHaveBeenCalledWith(["node-47"]);
  fireEvent.change(screen.getByRole("textbox", { name: "查找节点或备注" }), {
    target: { value: "不存在" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("没有匹配");
});
