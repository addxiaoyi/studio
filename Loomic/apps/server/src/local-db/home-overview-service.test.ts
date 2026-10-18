import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { loadHomeOverview } from "./home-overview-service.js";

describe("loadHomeOverview", () => {
  it("returns workspace totals and ordered daily generation data", async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ active_projects: 6, monthly_generations: 12, team_members: 2 }] })
        .mockResolvedValueOnce({ rows: [
          { date: "2026-10-12", image_requests: 1, video_requests: 2, completed: 2, failed: 1, credits_spent: "2.25" },
          { date: "2026-10-13", image_requests: 0, video_requests: 0, completed: 0, failed: 0, credits_spent: "0" },
        ] }),
    } as unknown as Pool;

    await expect(loadHomeOverview(db, "workspace-1", 14)).resolves.toEqual({
      periodDays: 14,
      activeProjects: 6,
      monthlyGenerations: 12,
      teamMembers: 2,
      daily: [
        { date: "2026-10-12", imageRequests: 1, videoRequests: 2, completed: 2, failed: 1, creditsSpent: 2.25 },
        { date: "2026-10-13", imageRequests: 0, videoRequests: 0, completed: 0, failed: 0, creditsSpent: 0 },
      ],
    });
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
