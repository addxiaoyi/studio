import { describe, expect, it } from "vitest";

import { canvasSaveStateLabel } from "../src/components/canvas-editor";

describe("canvas save state labels", () => {
  it("distinguishes debounce, in-flight, success, and failure states", () => {
    expect(canvasSaveStateLabel("pending")).toBe("待保存");
    expect(canvasSaveStateLabel("saving")).toBe("保存中…");
    expect(canvasSaveStateLabel("saved")).toBe("已保存");
    expect(canvasSaveStateLabel("error")).toBe("保存失败");
  });
});
