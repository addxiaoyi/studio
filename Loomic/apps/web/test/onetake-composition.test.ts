import { describe, expect, it, vi } from "vitest";
import { applyOneTakeExport, oneTakeEditId } from "../src/lib/onetake-composition";
import type { StudioRuntime, StudioSnapshot } from "../src/lib/visualforge-runtime";

const exportId = "123e4567-e89b-42d3-a456-426614174000";
const snapshot: StudioSnapshot = { compositionId: "MyComp", revision: "before", duration: 2, format: "landscape", captions: [], cut: null };
const output = { id: exportId, duration: 5, options: { aspect: "original" as const } };

describe("OneTake composition application", () => {
  it("uses a stable UUID scoped to the export and current composition", async () => {
    const id = await oneTakeEditId(exportId, "MyComp");
    expect(id.replaceAll("-", "")).toMatch(/^[a-f0-9]{32}$/);
    expect(await oneTakeEditId(exportId, "MyComp")).toBe(id);
    expect(await oneTakeEditId(exportId, "Other")).not.toBe(id);
  });
  it("does not repeat an applied edit after its receipt was lost", async () => {
    const id = await oneTakeEditId(exportId, snapshot.compositionId);
    const applyEdit = vi.fn();
    const runtime = { snapshot: async () => ({ ...snapshot, revision: "after", appliedEdits: [id] }), applyEdit } as unknown as StudioRuntime;
    await applyOneTakeExport(runtime, snapshot, output, "generated.mp4");
    expect(applyEdit).not.toHaveBeenCalled();
  });
  it("rejects a changed composition and uses the imported filename on success", async () => {
    const applyEdit = vi.fn();
    const read = vi.fn().mockResolvedValue({ ...snapshot, revision: "changed" });
    const runtime = { snapshot: read, applyEdit } as unknown as StudioRuntime;
    await expect(applyOneTakeExport(runtime, snapshot, output, "generated.mp4")).rejects.toThrow("已改变");
    expect(applyEdit).not.toHaveBeenCalled();
    read.mockResolvedValue(snapshot);
    await applyOneTakeExport(runtime, snapshot, output, "generated.mp4");
    expect(applyEdit).toHaveBeenCalledWith(expect.objectContaining({ compositionId: "MyComp", replaceVideo: true, cut: expect.objectContaining({ clips: [expect.objectContaining({ name: "generated.mp4", end: 5 })] }) }));
  });
});
