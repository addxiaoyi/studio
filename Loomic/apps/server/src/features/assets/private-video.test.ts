import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PrivateVideoConflict, savePrivateVideo } from "./private-video.js";

const input = { workspaceId: "workspace", userId: "user", uploadId: "upload", bytes: Buffer.from("video"), mimeType: "video/mp4" as const };

function fixture(existing: unknown[] = [], failOn = "") {
  const query = vi.fn(async (sql: string) => {
    if (failOn && sql.includes(failOn)) throw new Error("database unavailable");
    return { rows: sql.includes("from generated_assets ga") ? existing : [] };
  });
  const release = vi.fn();
  const db = { connect: vi.fn().mockResolvedValue({ query, release }) };
  const storage = { upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }) };
  return { query, release, db, storage };
}

describe("private video persistence", () => {
  it("registers an uploaded file with three-day retention", async () => {
    const f = fixture();
    const saved = await savePrivateVideo(f.db as never, f.storage as never, input);
    expect(saved.created).toBe(true);
    expect(f.storage.upload).toHaveBeenCalledWith("private-video", expect.any(String), input.bytes, expect.objectContaining({ upsert: false }));
    expect(f.query.mock.calls.some(([sql]) => sql.includes("interval '3 days'"))).toBe(true);
    expect(f.query.mock.calls.some(([sql]) => sql === "commit")).toBe(true);
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("returns the original object when a retry has the same content", async () => {
    const digest = createHash("sha256").update(input.bytes).digest("hex");
    const f = fixture([{ id: "existing", digest, mime_type: input.mimeType, active: true }]);
    await expect(savePrivateVideo(f.db as never, f.storage as never, input)).resolves.toEqual({ assetId: "existing", created: false });
    expect(f.storage.upload).not.toHaveBeenCalled();
  });

  it("refuses reuse with different or expired content", async () => {
    const f = fixture([{ id: "existing", digest: "different", mime_type: input.mimeType, active: true }]);
    await expect(savePrivateVideo(f.db as never, f.storage as never, input)).rejects.toBeInstanceOf(PrivateVideoConflict);
    expect(f.storage.upload).not.toHaveBeenCalled();
  });

  it("does not recreate an upload whose asset object was purged", async () => {
    const digest = createHash("sha256").update(input.bytes).digest("hex");
    const f = fixture([{ id: null, digest, mime_type: input.mimeType, active: false }]);
    await expect(savePrivateVideo(f.db as never, f.storage as never, input)).rejects.toBeInstanceOf(PrivateVideoConflict);
    expect(f.storage.upload).not.toHaveBeenCalled();
    expect(f.query.mock.calls.find(([sql]) => sql.includes("from generated_assets ga"))?.[0]).toContain("left join asset_objects");
  });

  it("cleans failed inserts but preserves an object when commit outcome is uncertain", async () => {
    const failedInsert = fixture([], "insert into generated_assets");
    await expect(savePrivateVideo(failedInsert.db as never, failedInsert.storage as never, input)).rejects.toThrow("database unavailable");
    expect(failedInsert.storage.remove).toHaveBeenCalledOnce();
    const failedCommit = fixture([], "commit");
    await expect(savePrivateVideo(failedCommit.db as never, failedCommit.storage as never, input)).rejects.toThrow("database unavailable");
    expect(failedCommit.storage.remove).not.toHaveBeenCalled();
  });
});
