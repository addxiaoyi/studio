// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/server-api", () => ({
  uploadFile: vi.fn(),
}));

import { CanvasTimelinePanel } from "../src/components/canvas-timeline-panel";

describe("CanvasTimelinePanel", () => {
  afterEach(cleanup);

  it("moves focus to the close control when opened", async () => {
    const api = {
      getSceneElements: () => [],
      onChange: () => () => undefined,
    };

    render(
      <CanvasTimelinePanel
        excalidrawApi={api}
        open
        onClose={vi.fn()}
        accessToken="test-token"
        projectId="project-1"
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "关闭时间线" })).toHaveFocus());
    expect(screen.getByRole("complementary", { name: "媒体时间线" })).not.toHaveAttribute("aria-live");
  });

  it("keeps timeline editing controls named and keyboard-visible", async () => {
    const api = {
      getSceneElements: () => [{
        id: "subtitle-1",
        type: "text",
        text: "开场字幕",
        customData: { isSubtitle: true, title: "开场字幕", subtitleStart: 0, subtitleEnd: 5 },
      }],
      onChange: () => () => undefined,
      updateScene: vi.fn(),
    };

    render(
      <CanvasTimelinePanel
        excalidrawApi={api}
        open
        onClose={vi.fn()}
        accessToken="test-token"
        projectId="project-1"
      />,
    );

    expect(screen.getByRole("textbox", { name: "字幕内容" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择开场字幕" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除开场字幕" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "底部" })).toHaveClass("focus-visible:ring-2");
    expect(screen.getByRole("complementary", { name: "媒体时间线" })).not.toHaveAttribute("aria-live");
  });

  it("restores focus to its trigger after closing", async () => {
    const api = {
      getSceneElements: () => [],
      onChange: () => () => undefined,
    };
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-label", "媒体时间线");
    document.body.append(trigger);
    const ref = { current: trigger };
    const { rerender } = render(
      <CanvasTimelinePanel
        excalidrawApi={api}
        open
        onClose={vi.fn()}
        triggerRef={ref}
        accessToken="test-token"
        projectId="project-1"
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭时间线" })).toHaveFocus());
    rerender(
      <CanvasTimelinePanel
        excalidrawApi={api}
        open={false}
        onClose={vi.fn()}
        triggerRef={ref}
        accessToken="test-token"
        projectId="project-1"
      />,
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });
});
