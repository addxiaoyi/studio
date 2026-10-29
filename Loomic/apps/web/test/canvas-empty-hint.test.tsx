// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasEmptyHint } from "../src/components/canvas-empty-hint";

describe("CanvasEmptyHint", () => {
  afterEach(cleanup);

  it("offers a keyboard-accessible first action for an empty canvas", async () => {
    const onOpenChat = vi.fn();
    render(
      <CanvasEmptyHint
        excalidrawApi={{ getSceneElements: () => [] }}
        ready
        onOpenChat={onOpenChat}
      />,
    );

    const action = await screen.findByRole("button", { name: "打开 AI 创作" });
    await userEvent.click(action);
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });

  it("does not cover Excalidraw while the scene is still hydrating", () => {
    render(
      <CanvasEmptyHint
        excalidrawApi={{ getSceneElements: () => [] }}
        ready={false}
        desktopMode
        onOpenChat={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /打开 AI 创作/ })).not.toBeInTheDocument();
  });

  it("uses a compact desktop prompt after the canvas has initialized", async () => {
    render(
      <CanvasEmptyHint
        excalidrawApi={{ getSceneElements: () => [] }}
        ready
        desktopMode
        onOpenChat={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "从一句话开始创作" })).toBeInTheDocument();
    expect(screen.getByText("快速打开对话")).toBeInTheDocument();
  });
});
