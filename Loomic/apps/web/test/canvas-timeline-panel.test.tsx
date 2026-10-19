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
    expect(screen.getByRole("complementary", { name: "媒体时间线" })).toHaveAttribute("aria-live", "polite");
  });
});
