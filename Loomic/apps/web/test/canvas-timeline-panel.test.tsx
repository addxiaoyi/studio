// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/server-api", () => ({
  uploadFile: vi.fn(),
}));

import { CanvasTimelinePanel } from "../src/components/canvas-timeline-panel";

describe("CanvasTimelinePanel", () => {
  afterEach(cleanup);
  it("dismisses only a blank canvas click, keeping item edits and drag gestures open",()=>{
    vi.stubGlobal("PointerEvent",MouseEvent);
    const close=vi.fn();
    const api={getSceneElements:()=>[{id:"shape",type:"rectangle",x:10,y:10,width:100,height:100}],getAppState:()=>({scrollX:0,scrollY:0,zoom:{value:1}}),onChange:()=>()=>{}};
    render(<><div data-canvas-surface><canvas data-testid="canvas"/></div><CanvasTimelinePanel excalidrawApi={api} open onClose={close} accessToken="test" projectId="project"/></>);
    const canvas=screen.getByTestId("canvas");
    fireEvent.pointerDown(screen.getByRole("textbox",{name:"字幕内容"}),{clientX:300,clientY:200});fireEvent.pointerUp(screen.getByRole("textbox",{name:"字幕内容"}),{clientX:300,clientY:200});expect(close).not.toHaveBeenCalled();
    fireEvent.pointerDown(canvas,{clientX:40,clientY:40,button:0});fireEvent.pointerUp(canvas,{clientX:40,clientY:40,button:0});expect(close).not.toHaveBeenCalled();
    fireEvent.pointerDown(canvas,{clientX:300,clientY:200,button:0});fireEvent.pointerUp(canvas,{clientX:340,clientY:200,button:0});expect(close).not.toHaveBeenCalled();
    fireEvent.pointerDown(canvas,{clientX:300,clientY:200,button:0});fireEvent.pointerUp(canvas,{clientX:300,clientY:200,button:0});expect(close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

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
