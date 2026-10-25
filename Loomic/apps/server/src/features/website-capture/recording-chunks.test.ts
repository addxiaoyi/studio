import { describe, expect, it } from "vitest";

import { assembleRecordingChunks } from "./assistant-hub.js";

describe("desktop recording chunk assembly", () => {
  it("joins ordered chunks into one base64 payload", () => {
    const chunks = new Map<number, string>([
      [1, "BBBB"],
      [0, "AAAA"],
      [2, "CC=="],
    ]);
    expect(assembleRecordingChunks(chunks, 3)).toBe("AAAABBBBCC==");
  });

  it("returns null when a chunk is missing", () => {
    const chunks = new Map<number, string>([
      [0, "AAAA"],
      [2, "CC=="],
    ]);
    expect(assembleRecordingChunks(chunks, 3)).toBeNull();
  });

  it("returns null for invalid totals and empty maps", () => {
    expect(assembleRecordingChunks(new Map(), 0)).toBeNull();
    expect(assembleRecordingChunks(new Map([[0, "AAAA"]]), -1)).toBeNull();
  });

  it("handles a single-chunk upload", () => {
    expect(assembleRecordingChunks(new Map([[0, "AAAA"]]), 1)).toBe("AAAA");
  });
});
