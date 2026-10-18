import { describe, expect, it, vi } from "vitest";
import { createLocalProjectService } from "./project-service.js";

const user = { id: "user-1", accessToken: "token", email: "user@example.com", userMetadata: {} };

describe("local project brand kit association", () => {
  it("updates the selected brand kit instead of dropping it", async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "workspace-1", name: "Personal Workspace" }] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 }),
    };
    const service = createLocalProjectService(db as never);

    await service.updateProject(user, "project-1", { brand_kit_id: "11111111-1111-4111-8111-111111111111" });

    expect(String(db.query.mock.calls[2]?.[0])).toContain("brand_kit_id = $1");
    expect(db.query.mock.calls[2]?.[1]).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "project-1",
      "workspace-1",
    ]);
  });
});
