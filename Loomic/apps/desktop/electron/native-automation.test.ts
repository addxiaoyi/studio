import { describe, expect, it } from "vitest";
import {
  groundNativeTarget,
  isSensitiveNativeTree,
  type NativeWindowNode,
} from "./native-automation.js";

describe("native UI credential filtering", () => {
  it.each(["Password", "One-time code", "OTP", "Verification code", "MFA token"])(
    "blocks screenshots if a sensitive control is present: %s",
    (title) => {
      const tree: NativeWindowNode = {
        role: "window",
        children: [{ role: "edit", title }],
      };
      expect(isSensitiveNativeTree(tree)).toBe(true);
    },
  );

  it("allows ordinary native UI trees", () => {
    expect(isSensitiveNativeTree({ role: "window", children: [{ role: "button", title: "Save" }] })).toBe(false);
  });
});

describe("pressNativeKey validation", () => {
  it("rejects unsupported keys without touching the keyboard", async () => {
    await expect(import("./native-automation.js").then((m) => m.pressNativeKey("PrintScreen"))).rejects.toThrow(/Unsupported native key/);
    await expect(import("./native-automation.js").then((m) => m.pressNativeKey("Enter", ["hyper"]))).rejects.toThrow(/Unsupported modifier/);
  });

  it("accepts known keys and modifiers", async () => {
    await expect(
      import("./native-automation.js").then((m) => m.pressNativeKey("esc", ["ctrl", "shift"])),
    ).resolves.toBeUndefined();
  });
});

describe("groundNativeTarget", () => {
  const evidence = {
    windowRegion: { left: 100, top: 50, width: 800, height: 600 },
    ocrWords: [
      { text: "Save", x: 10, y: 20, width: 40, height: 14 },
      { text: "file", x: 54, y: 20, width: 30, height: 14 },
      { text: "Settings", x: 300, y: 120, width: 60, height: 14 },
    ],
    pixelScale: 1,
  };

  it("maps a unique OCR phrase to window-relative screen coordinates", () => {
    const result = groundNativeTarget({ text: "Save file" }, evidence);
    expect(result.source).toBe("ocr_text");
    expect(result.x).toBeCloseTo(149.5, 1);
    expect(result.y).toBe(50 + 27);
  });

  it("scales OCR word boxes by pixelScale on high-DPI displays", () => {
    const hidpi = { ...evidence, pixelScale: 2 };
    const result = groundNativeTarget({ text: "Save file" }, hidpi);
    expect(result.x).toBeCloseTo(100 + (30 + 69) / 2 / 2, 1);
    expect(result.y).toBeCloseTo(50 + 27 / 2, 1);
  });

  it("rejects ambiguous text targets", () => {
    const ambiguous = {
      ...evidence,
      ocrWords: [...evidence.ocrWords, { text: "Save", x: 500, y: 300, width: 40, height: 14 }],
    };
    expect(() => groundNativeTarget({ text: "Save" }, ambiguous)).toThrow(/ambiguous/);
  });

  it("maps in-window relative coordinates to screen coordinates", () => {
    const result = groundNativeTarget({ x: 400, y: 300 }, evidence);
    expect(result.source).toBe("coordinates");
    expect(result).toMatchObject({ x: 500, y: 350, confidence: 1 });
  });

  it("rejects coordinates outside the window region", () => {
    expect(() => groundNativeTarget({ x: 900, y: 300 }, evidence)).toThrow(/outside/);
  });

  it("maps screenshot pixel coordinates through pixelScale", () => {
    const hidpi = { ...evidence, pixelScale: 2, screenshotWidth: 1600, screenshotHeight: 1200 };
    const result = groundNativeTarget({ screenshotX: 400, screenshotY: 300 }, hidpi);
    expect(result.source).toBe("coordinates");
    expect(result).toMatchObject({ x: 300, y: 200, confidence: 0.9 });
  });

  it("rejects screenshot coordinates without evidence or outside the screenshot", () => {
    expect(() => groundNativeTarget({ screenshotX: 10, screenshotY: 10 }, evidence)).toThrow(/requires fresh screen evidence/);
    expect(() => groundNativeTarget({ screenshotX: 2000, screenshotY: 100 }, { ...evidence, pixelScale: 1, screenshotWidth: 1600, screenshotHeight: 1200 })).toThrow(/outside/);
  });

  it("rejects targets that match nothing", () => {
    expect(() => groundNativeTarget({ text: "Missing button" }, evidence)).toThrow(/not found/);
    expect(() => groundNativeTarget({}, evidence)).toThrow(/requires either/);
  });
});
