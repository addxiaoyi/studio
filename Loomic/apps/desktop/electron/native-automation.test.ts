import { beforeEach, describe, expect, it, vi } from "vitest";

const keyboard = vi.hoisted(() => ({
  pressKey: vi.fn().mockResolvedValue(undefined),
  type: vi.fn().mockResolvedValue(undefined),
  releaseKey: vi.fn().mockResolvedValue(undefined),
}));

const nativeScreen = vi.hoisted(() => ({
  capture: vi.fn(),
  activeWindow: vi.fn(),
  createWorker: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  inspectUia: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: nativeScreen.mkdtemp,
  readFile: nativeScreen.readFile,
  rm: nativeScreen.rm,
}));
vi.mock("tesseract.js", () => ({ createWorker: nativeScreen.createWorker }));
vi.mock("./windows-uia.js", () => ({
  inspectWindowsUia: nativeScreen.inspectUia,
  setWindowsUiaValue: vi.fn(),
}));

vi.mock("@nut-tree/nut-js", () => ({
  Key: {
    Enter: 13,
    Escape: 27,
    LeftControl: 17,
    LeftShift: 16,
  },
  keyboard,
  screen: { captureRegion: nativeScreen.capture },
  getActiveWindow: nativeScreen.activeWindow,
  FileType: { PNG: "png" },
}));
import {
  groundNativeTarget,
  isSensitiveNativeTree,
  getNativeBackendAvailability,
  inspectNativeDesktop,
  pressNativeKey,
  type NativeWindowNode,
} from "./native-automation.js";

describe("native screenshot cleanup", () => {
  const options = { platform: "win32" as const, userDataPath: "native-test-profile" };
  const temporaryDirectory = "native-test-screenshot-directory";

  beforeEach(() => {
    nativeScreen.activeWindow.mockReset().mockResolvedValue({
      title: "Design studio",
      region: { left: 0, top: 0, width: 800, height: 600 },
    });
    nativeScreen.inspectUia.mockReset().mockResolvedValue({ title: "Design studio", controls: [] });
    nativeScreen.mkdtemp.mockReset().mockResolvedValue(temporaryDirectory);
    nativeScreen.capture.mockReset().mockResolvedValue("native-test-screen.png");
    nativeScreen.readFile.mockReset().mockResolvedValue(Buffer.from("test screenshot"));
    nativeScreen.createWorker.mockReset().mockResolvedValue({
      recognize: nativeScreen.recognize,
      terminate: nativeScreen.terminate,
    });
    nativeScreen.recognize.mockReset().mockResolvedValue({ data: { text: "Save", blocks: [] } });
    nativeScreen.terminate.mockReset().mockResolvedValue(undefined);
    nativeScreen.rm.mockReset().mockResolvedValue(undefined);
  });

  it("still removes the screenshot directory when OCR worker termination fails", async () => {
    const terminateError = new Error("OCR worker termination failed");
    nativeScreen.terminate.mockRejectedValueOnce(terminateError);
    const failure = await inspectNativeDesktop(options).catch((error: unknown) => error);
    expect(nativeScreen.rm).toHaveBeenCalledExactlyOnceWith(temporaryDirectory, { recursive: true, force: true });
    expect(failure).toMatchObject({ name: "AggregateError", errors: [terminateError] });
  });

  it("preserves the OCR error and both cleanup errors", async () => {
    const ocrError = new Error("OCR recognition failed");
    const terminateError = new Error("OCR worker termination failed");
    const removeError = new Error("Screenshot removal failed");
    nativeScreen.recognize.mockRejectedValueOnce(ocrError);
    nativeScreen.terminate.mockRejectedValueOnce(terminateError);
    nativeScreen.rm.mockRejectedValueOnce(removeError);
    await expect(inspectNativeDesktop(options)).rejects.toMatchObject({
      name: "AggregateError",
      cause: ocrError,
      errors: [ocrError, terminateError, removeError],
    });
    expect(nativeScreen.rm).toHaveBeenCalledOnce();
  });

  it("keeps the original OCR failure when cleanup succeeds", async () => {
    const ocrError = new Error("OCR recognition failed");
    nativeScreen.recognize.mockRejectedValueOnce(ocrError);
    await expect(inspectNativeDesktop(options)).rejects.toBe(ocrError);
    expect(nativeScreen.terminate).toHaveBeenCalledOnce();
    expect(nativeScreen.rm).toHaveBeenCalledOnce();
  });

  it("removes a failed capture's directory before any OCR worker exists", async () => {
    const captureError = new Error("Capture failed");
    nativeScreen.capture.mockRejectedValueOnce(captureError);
    await expect(inspectNativeDesktop(options)).rejects.toBe(captureError);
    expect(nativeScreen.createWorker).not.toHaveBeenCalled();
    expect(nativeScreen.rm).toHaveBeenCalledOnce();
  });

  it("returns evidence after capture and cleanup both succeed", async () => {
    await expect(inspectNativeDesktop(options)).resolves.toMatchObject({
      windowTitle: "Design studio",
      ocrText: "Save",
      screenshotBase64: Buffer.from("test screenshot").toString("base64"),
    });
    expect(nativeScreen.terminate).toHaveBeenCalledOnce();
    expect(nativeScreen.rm).toHaveBeenCalledOnce();
  });
});

describe("native UI credential filtering", () => {
  it("reports platform-specific permission states without claiming unsupported backends", () => {
    expect(getNativeBackendAvailability("win32")).toMatchObject({ backend: "windows-uia", supported: true, permission: "not_required" });
    expect(getNativeBackendAvailability("darwin")).toMatchObject({ backend: "macos-accessibility", supported: false, permission: "unknown" });
    expect(getNativeBackendAvailability("linux", "wayland")).toMatchObject({ backend: "linux-atspi", supported: false, permission: "unknown" });
  });
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
  beforeEach(() => {
    keyboard.pressKey.mockReset().mockResolvedValue(undefined);
    keyboard.type.mockReset().mockResolvedValue(undefined);
    keyboard.releaseKey.mockReset().mockResolvedValue(undefined);
  });

  it("rejects unsupported keys without touching the keyboard", async () => {
    await expect(import("./native-automation.js").then((m) => m.pressNativeKey("PrintScreen"))).rejects.toThrow(/Unsupported native key/);
    await expect(import("./native-automation.js").then((m) => m.pressNativeKey("Enter", ["hyper"]))).rejects.toThrow(/Unsupported modifier/);
  });

  it("accepts known keys and modifiers", async () => {
    await expect(
      import("./native-automation.js").then((m) => m.pressNativeKey("esc", ["ctrl", "shift"])),
    ).resolves.toBeUndefined();
  });

  it("preserves action and release failures while releasing every held modifier", async () => {
    const actionError = new Error("Native key delivery failed");
    const releaseError = new Error("Shift release failed");
    keyboard.type.mockRejectedValueOnce(actionError);
    keyboard.releaseKey.mockRejectedValueOnce(releaseError);

    await expect(pressNativeKey("enter", ["ctrl", "shift"])).rejects.toMatchObject({
      name: "AggregateError",
      cause: actionError,
      errors: [actionError, releaseError],
    });
    expect(keyboard.releaseKey.mock.calls).toEqual([[16], [17]]);
  });

  it("rethrows the original action error when modifier cleanup succeeds", async () => {
    const actionError = new Error("Native key delivery failed");
    keyboard.type.mockRejectedValueOnce(actionError);
    await expect(pressNativeKey("enter", ["ctrl"])).rejects.toBe(actionError);
    expect(keyboard.releaseKey).toHaveBeenCalledExactlyOnceWith(17);
  });

  it("reports release errors after a successful action", async () => {
    const releaseError = new Error("Control release failed");
    keyboard.releaseKey.mockRejectedValueOnce(releaseError);
    await expect(pressNativeKey("enter", ["ctrl"])).rejects.toMatchObject({
      name: "AggregateError",
      errors: [releaseError],
    });
  });

  it("still releases a modifier whose press failed and keeps both errors", async () => {
    const pressError = new Error("Control press failed");
    const releaseError = new Error("Control release failed");
    keyboard.pressKey.mockRejectedValueOnce(pressError);
    keyboard.releaseKey.mockRejectedValueOnce(releaseError);
    await expect(pressNativeKey("enter", ["ctrl", "shift"])).rejects.toMatchObject({
      name: "AggregateError",
      cause: pressError,
      errors: [pressError, releaseError],
    });
    expect(keyboard.type).not.toHaveBeenCalled();
    expect(keyboard.releaseKey).toHaveBeenCalledExactlyOnceWith(17);
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
