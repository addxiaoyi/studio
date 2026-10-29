import { describe, expect, it } from "vitest";

import {
  CANVAS_RECOVERY_PREFIX,
  canvasRecoveryKey,
  clearCanvasRecoveryCopy,
  readCanvasRecoveryCopy,
  writeCanvasRecoveryCopy,
  type CanvasSavePayload,
} from "../src/components/canvas-editor";

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const payload: CanvasSavePayload = {
  elements: [{ id: "el-1", type: "rectangle" }],
  appState: { viewBackgroundColor: "#ffffff" },
  files: { file1: { id: "file1", dataURL: "data:image/png;base64,AA==" } },
};

describe("canvas local recovery copy", () => {
  it("round-trips the newest payload so a refresh can restore it", () => {
    const storage = new MemoryStorage();

    expect(writeCanvasRecoveryCopy("canvas-1", payload, storage)).toBe(true);
    const copy = readCanvasRecoveryCopy("canvas-1", storage);

    expect(copy).not.toBeNull();
    expect(copy?.content).toEqual(payload);
    expect(copy?.savedAt).toBeGreaterThan(0);
    expect(storage.getItem(canvasRecoveryKey("canvas-1"))).not.toBeNull();
    expect(canvasRecoveryKey("canvas-1").startsWith(CANVAS_RECOVERY_PREFIX)).toBe(true);
  });

  it("isolates copies per canvas and clears only the requested one", () => {
    const storage = new MemoryStorage();
    writeCanvasRecoveryCopy("canvas-1", payload, storage);
    writeCanvasRecoveryCopy("canvas-2", payload, storage);

    clearCanvasRecoveryCopy("canvas-1", storage);

    expect(readCanvasRecoveryCopy("canvas-1", storage)).toBeNull();
    expect(readCanvasRecoveryCopy("canvas-2", storage)).not.toBeNull();
  });

  it("ignores corrupt or structurally invalid copies instead of throwing", () => {
    const storage = new MemoryStorage();
    storage.setItem(canvasRecoveryKey("canvas-bad-json"), "{not json");
    storage.setItem(
      canvasRecoveryKey("canvas-bad-shape"),
      JSON.stringify({ savedAt: 1, content: { elements: "nope" } }),
    );

    expect(readCanvasRecoveryCopy("canvas-bad-json", storage)).toBeNull();
    expect(readCanvasRecoveryCopy("canvas-bad-shape", storage)).toBeNull();
    expect(readCanvasRecoveryCopy("canvas-missing", storage)).toBeNull();
  });

  it("reports failure instead of throwing when storage rejects the write", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("quota exceeded");
    };

    expect(writeCanvasRecoveryCopy("canvas-1", payload, storage)).toBe(false);
  });
});
