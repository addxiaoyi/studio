import { describe, expect, it } from "vitest";
import { calculateModelPopoverLayout } from "../src/components/image-model-preference";
import { viewportPointToScene } from "../src/lib/canvas-elements";

describe("adaptive model popover", () => {
  it("fits narrow viewports and opens above a low anchor", () => {
    const layout = calculateModelPopoverLayout(
      { top: 700, bottom: 740, left: 300, right: 360 } as DOMRect,
      { width: 375, height: 800 },
    );
    expect(layout.width).toBe(359);
    expect(layout.above).toBe(true);
    expect(layout.left).toBe(8);
    expect(layout.maxHeight).toBeLessThanOrEqual(620);
  });
});

describe("canvas drop coordinates", () => {
  it("maps viewport coordinates through zoom and scroll", () => {
    expect(viewportPointToScene(
      { clientX: 250, clientY: 180 },
      { left: 50, top: 20 },
      { scrollX: -40, scrollY: 10, zoom: { value: 2 } },
    )).toEqual({ x: 140, y: 70 });
  });
});
