import { describe, expect, it, vi } from "vitest";
import { loadProjectContext } from "./project-context.js";
import type { Pool } from "pg";

const project = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const canvas = "33333333-3333-4333-8333-333333333333";
const session = "44444444-4444-4444-8444-444444444444";
const user = "55555555-5555-4555-8555-555555555555";
const goal = "66666666-6666-4666-8666-666666666666";

function database(activeGoal: unknown[] = []) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("from projects p join workspaces")) return {
      rows: [{ id: project, name: "网站介绍", workspace_id: workspace, canvas_id: canvas, canvas_name: "主画布", session_id: session, view: "video", composition_id: "开场", revision: 4, updated_at: "2026-11-13T00:00:00.000Z" }],
    };
    if (sql.includes("from chat_sessions")) return { rows: [{ id: session, title: "创作对话" }] };
    if (sql.includes("from agent_goals")) return { rows: activeGoal };
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query } as unknown as Pick<Pool, "query">;
}

describe("loadProjectContext", () => {
  it("returns an active Agent goal as the next step for the current canvas", async () => {
    const db = database([{ id: goal, goal: "录制并整理网站介绍", status: "running" }]);
    const context = await loadProjectContext(db, user, { projectId: project, canvasId: canvas });

    expect(context?.nextStep).toEqual({
      kind: "agent_goal",
      label: "继续：录制并整理网站介绍",
      goalId: goal,
      status: "running",
    });
  });

  it("returns a safe null next step when no Agent goal is active", async () => {
    const context = await loadProjectContext(database(), user, { projectId: project, canvasId: canvas });
    expect(context?.nextStep).toBeNull();
  });
});
