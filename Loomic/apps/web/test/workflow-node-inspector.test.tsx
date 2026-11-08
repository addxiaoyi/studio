// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { websiteWorkflow } from "@helstera/shared";
import { NodeInspector } from "@/components/workflow/node-inspector";
afterEach(cleanup);
it("edits recording scope without executing and exposes removable input connections", () => {
  const graph = websiteWorkflow(),
    change = vi.fn(),
    disconnect = vi.fn();
  render(
    <NodeInspector
      node={graph.nodes[1]!}
      graph={graph}
      disabled={false}
      onChange={change}
      onConnect={vi.fn()}
      onDisconnect={disconnect}
      onDelete={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "录制视频" }));
  expect(change).toHaveBeenCalledWith(
    expect.objectContaining({
      config: { kind: "capture", record: true, pageLimit: 1 },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "断开site到capture" }));
  expect(disconnect).toHaveBeenCalledWith("e-1");
});
it("locks editing and deletion while the confirmed version is running", () => {
  const graph = websiteWorkflow();
  render(
    <NodeInspector
      node={graph.nodes[0]!}
      graph={graph}
      disabled
      onChange={vi.fn()}
      onConnect={vi.fn()}
      onDisconnect={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  expect(screen.getByRole("textbox", { name: "目标网址" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "删除此节点" })).toBeDisabled();
});
