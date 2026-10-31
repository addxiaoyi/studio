import { describe, expect, it, vi } from "vitest";
import { assertConnectorEnabled } from "./connector-gate.js";

describe("connector execution gate", () => {
  it("rejects an explicitly disabled connector for the current user and workspace", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ enabled: false }] });
    await expect(assertConnectorEnabled({ query } as never, "workspace", "user", "desktop-agent"))
      .rejects.toThrow("desktop-agent connector is disabled");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("workspace_id=$1 and user_id=$2"), ["workspace", "user", "desktop-agent"]);
  });

  it.each([{ rows: [] }, { rows: [{ enabled: true }] }])("allows legacy or enabled preferences: %j", async ({ rows }) => {
    const query = vi.fn().mockResolvedValue({ rows });
    await expect(assertConnectorEnabled({ query } as never, "workspace", "user", "isolated-browser")).resolves.toBeUndefined();
  });

  it("fails closed when the permission store is unavailable", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(assertConnectorEnabled({ query } as never, "workspace", "user", "isolated-browser")).rejects.toThrow("database unavailable");
  });
});
