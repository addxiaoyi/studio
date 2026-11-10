import { describe, expect, it } from "vitest";
import { restoreWindowPlacement } from "./window-placement.js";

const primary = { x: 0, y: 0, width: 1280, height: 720 };
describe("window placement", () => {
  it("fits a first launch to a small or high DPI display", () => {
    expect(restoreWindowPlacement(null, [primary])).toEqual({ bounds: primary, maximized: false });
  });
  it("brings a disconnected monitor's window back to the primary display", () => {
    expect(restoreWindowPlacement({ bounds: { x: 2200, y: 300, width: 1400, height: 900 }, maximized: true }, [primary]))
      .toEqual({ bounds: primary, maximized: true });
  });
  it("keeps a visible window on a negative-coordinate monitor", () => {
    const bounds = { x: -1100, y: 40, width: 900, height: 600 };
    expect(restoreWindowPlacement({ bounds, maximized: false }, [primary, { x: -1280, y: 0, width: 1280, height: 720 }]).bounds).toEqual(bounds);
  });
  it("rejects corrupt saved dimensions and clamps partly hidden windows", () => {
    expect(restoreWindowPlacement({ bounds: { x: 1, y: 2, width: -5, height: 900 } }, [primary]).bounds).toEqual(primary);
    expect(restoreWindowPlacement({ bounds: { x: 1200, y: 600, width: 800, height: 500 } }, [primary]).bounds)
      .toEqual({ x: 480, y: 220, width: 800, height: 500 });
  });
});
