import { describe, expect, it, vi } from "vitest";

import { WebsiteAssistantHub } from "./assistant-hub.js";

function buildHub(query: ReturnType<typeof vi.fn>) {
  return new WebsiteAssistantHub({
    db: { query } as never,
    storage: {} as never,
    webOrigin: "https://studio.example.test",
    storageRoot: "/tmp/website-capture-test",
  });
}

describe("website assistant action workspace authorization", () => {
  it("scopes pending action reads to user and workspace", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const hub = buildHub(query);

    await expect(hub.listPendingActions("user-1", "workspace-1", "task-1")).resolves.toEqual([]);

    expect(query.mock.calls[1]?.[0]).toContain("workspace_id=$3");
    expect(query.mock.calls[1]?.[1]).toEqual(["task-1", "user-1", "workspace-1"]);
  });

  it("cannot approve an action outside the active workspace", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const hub = buildHub(query);

    await expect(hub.approveAction("user-1", "workspace-1", "action-1")).rejects.toThrow("动作确认已过期或不存在");

    expect(query.mock.calls[1]?.[0]).toContain("workspace_id=$3");
    expect(query.mock.calls[1]?.[0]).toContain("approval_token_hash=$4");
    expect(query.mock.calls[1]?.[1]?.slice(0, 2)).toEqual(["action-1", "user-1"]);
    expect(query.mock.calls[1]?.[1]?.[2]).toBe("workspace-1");
    expect(query.mock.calls[1]?.[1]).toHaveLength(4);
  });

  it("cannot reject an action outside the active workspace", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const hub = buildHub(query);

    await expect(hub.rejectAction("user-1", "workspace-1", "action-1")).rejects.toThrow("动作确认已过期或不存在");

    expect(query.mock.calls[1]?.[0]).toContain("workspace_id=$3");
    expect(query.mock.calls[1]?.[0]).toContain("expires_at > now()");
    expect(query.mock.calls[1]?.[1]).toEqual(["action-1", "user-1", "workspace-1"]);
  });
});
