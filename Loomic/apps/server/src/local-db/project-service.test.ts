import { describe, expect, it, vi } from "vitest";

import { createLocalProjectService } from "./project-service.js";

function buildDb(rowCount: number) {
  const query = vi.fn()
    .mockResolvedValueOnce({ rows: [{ id: "workspace-1", name: "Personal Workspace" }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rowCount });
  return { query } as never;
}

const user = {
  id: "user-1",
  accessToken: "token",
  email: "user@example.com",
  userMetadata: {},
};

describe("local project archive guard", () => {
  it("archives only when the guarded empty-project update matches", async () => {
    const db = buildDb(1) as { query: ReturnType<typeof vi.fn> };
    const service = createLocalProjectService(db as never);

    await expect(service.archiveEmptyProject(user, "project-1")).resolves.toBe(true);

    const sql = String(db.query.mock.calls[2]?.[0]);
    expect(sql).toContain("jsonb_array_length");
    expect(sql).toContain("asset_objects");
    expect(sql).toContain("generated_assets");
    expect(sql).not.toContain("jsonb_object_length");
  });

  it("does not report deletion when the project is not safely empty", async () => {
    const db = buildDb(0) as { query: ReturnType<typeof vi.fn> };
    const service = createLocalProjectService(db as never);

    await expect(service.archiveEmptyProject(user, "project-1")).resolves.toBe(false);
  });
});
