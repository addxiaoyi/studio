import { expect, it } from "vitest";
import { canvasFocusTargets } from "@/lib/canvas-focus";

it("fits all restored content while excluding deleted elements", () => {
  const elements = [{ id: "left", x: -10000 }, { id: "right", x: 10000 }, { id: "deleted", isDeleted: true }];
  expect(canvasFocusTargets(elements, new URLSearchParams("fitContent=1"))).toEqual(elements.slice(0, 2));
  expect(canvasFocusTargets(elements, new URLSearchParams())).toEqual([]);
});

it("preserves explicit capture focus and ignores unavailable elements", () => {
  const elements = [{ id: "a" }, { id: "b" }, { id: "c", isDeleted: true }];
  expect(canvasFocusTargets(elements, new URLSearchParams("focusElements=b,c,missing"))).toEqual([{ id: "b" }]);
});
