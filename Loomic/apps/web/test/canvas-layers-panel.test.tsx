// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasLayersPanel } from "../src/components/canvas-layers-panel";

describe("CanvasLayersPanel", () => {
  afterEach(cleanup);

  it("keeps layer selection and layer actions as sibling controls", () => {
    const api = {
      getSceneElements: () => [{ id: "layer-1", type: "rectangle", isDeleted: false }],
      getFiles: () => ({}),
      getAppState: () => ({ selectedElementIds: { "layer-1": true } }),
      onChange: () => () => undefined,
      updateScene: vi.fn(),
    };
    render(<CanvasLayersPanel excalidrawApi={api} open onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "选择图层 Rectangle" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Lock layer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle layer visibility" })).toBeInTheDocument();
    expect(document.querySelector("button button")).toBeNull();
  });
});
