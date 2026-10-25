import { describe, expect, it } from "vitest";

import {
  actionsAllowedForCapabilities,
  filterActionsByCapabilities,
  plannedActionOutputSchema,
} from "./desktop-agent-planning.js";

describe("desktop agent planning", () => {
  it("derives allowed action kinds from capabilities", () => {
    const allowed = actionsAllowedForCapabilities(["window.click", "window.key"]);
    expect(allowed).toContain("native_click");
    expect(allowed).toContain("native_double_click");
    expect(allowed).toContain("native_right_click");
    expect(allowed).toContain("native_key");
    expect(allowed).toContain("wait");
    expect(allowed).toContain("capture_screen");
    expect(allowed).not.toContain("native_type");
    expect(allowed).not.toContain("native_drag");
  });

  it("always permits wait and capture_screen", () => {
    const allowed = actionsAllowedForCapabilities([]);
    expect(allowed).toContain("wait");
    expect(allowed).toContain("capture_screen");
    expect(allowed).toHaveLength(2);
  });

  it("filters planner output to granted capabilities and caps at 8", () => {
    const actions = [
      { kind: "native_click", target: "Save" },
      { kind: "native_key", key: "Enter" },
      { kind: "native_type", target: "search", value: "hello" },
      { kind: "wait", durationMs: 200 },
      { kind: "native_drag", x: 1, y: 2, toX: 3, toY: 4 },
    ];
    const filtered = filterActionsByCapabilities(actions, ["window.click", "window.key"]);
    expect(filtered.map((action) => action.kind)).toEqual(["native_click", "native_key", "wait"]);
  });

  it("caps the plan length at 8 actions", () => {
    const actions = Array.from({ length: 12 }, (_, index) => ({ kind: "wait", durationMs: 100 + index }));
    expect(filterActionsByCapabilities(actions, [])).toHaveLength(8);
  });

  it("validates planner output actions against the action schema", () => {
    expect(
      plannedActionOutputSchema.safeParse({ kind: "native_key", key: "Enter", modifiers: ["ctrl"] }).success,
    ).toBe(true);
    expect(
      plannedActionOutputSchema.safeParse({ kind: "native_scroll", dx: 0, dy: -3 }).success,
    ).toBe(true);
    expect(
      plannedActionOutputSchema.safeParse({ kind: "native_click", x: 120, y: 340 }).success,
    ).toBe(true);
    expect(
      plannedActionOutputSchema.safeParse({ kind: "explode" }).success,
    ).toBe(false);
    expect(
      plannedActionOutputSchema.safeParse({ kind: "wait", durationMs: 61_000 }).success,
    ).toBe(false);
  });
});
