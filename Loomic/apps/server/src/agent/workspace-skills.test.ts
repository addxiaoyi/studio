import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { loadLocalWorkspaceSkills } from "./workspace-skills.js";

describe("local workspace skill loading", () => {
  it("loads only declarative plugins installed by this user in the workspace", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ slug: "brand-voice", name: "Brand Voice", description: "Brand copy guidance", instructions: "Use the workspace brand voice." }] });

    const entries = await loadLocalWorkspaceSkills({ query } as unknown as Pool, "canvas-1", "user-1");

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toContain("a.user_id=$2");
    expect(query.mock.calls[1]?.[1]).toEqual(["canvas-1", "user-1"]);
    expect(entries).toEqual([expect.objectContaining({ name: "plugin-brand-voice", content: expect.stringContaining("cannot grant additional tools") })]);
  });

  it("loads the locked snapshot and current files for unlocked skills", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { id: "skill-locked", slug: "locked-skill", description: "pinned", skill_content: "current", locked_version: "1.0", snapshot: { skillContent: "pinned content", files: [{ filePath: "scripts/pinned.js", content: "pinned script" }] } },
        { id: "skill-live", slug: "live-skill", description: "live", skill_content: "live content", locked_version: null, snapshot: null },
      ] })
      .mockResolvedValueOnce({ rows: [{ skill_id: "skill-live", file_path: "references/live.md", content: "current reference" }] });

    const skills = await loadLocalWorkspaceSkills({ query } as unknown as Pool, "canvas-1");

    expect(query).toHaveBeenCalledTimes(2);
    expect(skills).toEqual([
      expect.objectContaining({ name: "locked-skill", content: "pinned content", files: [{ path: "scripts/pinned.js", content: "pinned script" }] }),
      expect.objectContaining({ name: "live-skill", content: "live content", files: [{ path: "references/live.md", content: "current reference" }] }),
    ]);
  });

  it("skips a locked skill whose version snapshot is missing", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [
      { id: "skill-1", slug: "missing-snapshot", description: "", skill_content: "new content", locked_version: "0.9", snapshot: null },
    ] });

    await expect(loadLocalWorkspaceSkills({ query } as unknown as Pool, "canvas-1")).resolves.toEqual([]);
    expect(query).toHaveBeenCalledOnce();
  });
});
