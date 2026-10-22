import { describe, expect, it, vi } from "vitest";

import { persistCaptureAsset } from "./isolated-browser.js";

function input(query: ReturnType<typeof vi.fn>, upload = vi.fn().mockResolvedValue({ error: null }), remove = vi.fn().mockResolvedValue({ error: null })) {
  const client = { query, release: vi.fn() };
  const db = { connect: vi.fn().mockResolvedValue(client) };
  return {
    options: {
      db,
      storage: { upload, remove },
      storageRoot: "/tmp/captures",
      webOrigin: "https://studio.example.test",
      task: { id: "task-1", workspace_id: "workspace-1", created_by: "user-1", start_url: "https://example.test", page_limit: 2, record_video: false },
      bytes: Buffer.from("image"),
      mimeType: "image/jpeg",
      mediaType: "image" as const,
      title: "Capture image",
      metadata: { sourceUrl: "https://example.test/" },
    },
    db,
    client,
    upload,
    remove,
  };
}

describe("persist website capture asset", () => {
  it("commits asset metadata and links the generated asset to its capture task", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "object-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const fixture = input(query);

    const asset = await persistCaptureAsset(fixture.options as never);

    expect(asset.id).toBe("object-1");
    expect(query.mock.calls[0]?.[0]).toBe("begin");
    expect(query.mock.calls[2]?.[0]).toContain("website_capture_task_id");
    expect(query.mock.calls[2]?.[1]?.[8]).toBe("task-1");
    expect(query.mock.calls[3]?.[0]).toBe("commit");
    expect(fixture.db.connect).toHaveBeenCalledOnce();
    expect(fixture.client.release).toHaveBeenCalledOnce();
    expect(fixture.remove).not.toHaveBeenCalled();
  });

  it("rolls back metadata and removes uploaded bytes if the asset insert fails", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "object-1" }] })
      .mockRejectedValueOnce(new Error("metadata insert failed"))
      .mockResolvedValueOnce({ rows: [] });
    const fixture = input(query);

    await expect(persistCaptureAsset(fixture.options as never)).rejects.toThrow("metadata insert failed");

    expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
    expect(fixture.remove).toHaveBeenCalledWith("project-assets", [expect.stringContaining("workspace-1/generated/website-capture/task-1/")]);
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });

  it("does not open a database transaction when storage upload fails", async () => {
    const query = vi.fn();
    const fixture = input(query, vi.fn().mockResolvedValue({ error: new Error("storage unavailable") }));

    await expect(persistCaptureAsset(fixture.options as never)).rejects.toThrow("Could not save capture asset");

    expect(fixture.db.connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("removes the uploaded object when a database connection cannot be acquired", async () => {
    const query = vi.fn();
    const fixture = input(query);
    fixture.db.connect.mockRejectedValue(new Error("database unavailable"));

    await expect(persistCaptureAsset(fixture.options as never)).rejects.toThrow("database unavailable");

    expect(fixture.remove).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
  });
});
