import { expect, it, vi } from "vitest";
import { AgentGoalWorker } from "./agent-goal-worker.js";
import { GoalStepWorker } from "./goal-step-worker.js";

it.each(["goals", "steps"] as const)("stops %s after an outstanding scan without claiming more work", async kind => {
  let finish!: (rows: { rows: { id: string }[] }) => void;
  const db = {
    query: vi.fn(() => new Promise(done => { finish = done; })),
    connect: vi.fn().mockRejectedValue(new Error("Unexpected new claim after stop")),
  };
  const worker = kind === "goals"
    ? new AgentGoalWorker(db as never, { createDesktopAgentTask: vi.fn() })
    : new GoalStepWorker(db as never, vi.fn());
  const scan = worker.tick();
  let drained = false;
  const stopping = Promise.resolve(worker.stop()).then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  finish({ rows: [{ id: "late-goal" }] });
  await Promise.all([scan, stopping]);
  expect(drained).toBe(true);
  expect(db.connect).not.toHaveBeenCalled();
  await worker.tick();
  expect(db.query).toHaveBeenCalledTimes(1);
});
