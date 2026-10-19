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
        onOpenChat={onOpenChat}
      />,
    );

    const action = await screen.findByRole("button", { name: "打开 AI 创作" });
    await userEvent.click(action);
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });
});
