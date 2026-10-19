// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasBottomBar } from "../src/components/canvas-bottom-bar";

describe("CanvasBottomBar", () => {
  afterEach(cleanup);

  it("exposes selection actions and a labelled zoom control", async () => {
    const onClearSelection = vi.fn();
    const onDeleteSelection = vi.fn();
    const api = {
      getAppState: () => ({
        zoom: { value: 1 },
        viewBackgroundColor: "#FFFFFF",
        currentItemRoughness: 0,
        selectedElementIds: { "element-1": true },
      }),
      getSceneElements: () => [{ id: "element-1", type: "rectangle" }],
      onChange: () => () => undefined,
      updateScene: vi.fn(),
    };

    render(
      <CanvasBottomBar
        excalidrawApi={api}
        layersOpen={false}
        onToggleLayers={vi.fn()}
        filesOpen={false}
        onToggleFiles={vi.fn()}
        timelineOpen={false}
        onToggleTimeline={vi.fn()}
        leftPanelOpen={false}
        selectedCount={2}
        onClearSelection={onClearSelection}
        onDeleteSelection={onDeleteSelection}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("已选 2 项");
    expect(screen.getByRole("button", { name: "缩放比例 100%，打开缩放选项" })).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(screen.getByRole("button", { name: "删除选中元素" }));
    await userEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(onDeleteSelection).toHaveBeenCalledOnce();
    expect(onClearSelection).toHaveBeenCalledOnce();
  });
});
