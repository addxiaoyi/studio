import { expect, it, vi } from "vitest";
import { ServiceLifecycle } from "../../runtime/lifecycle.js";
import { AgentGoalWorker } from "./agent-goal-worker.js";
import { type GoalStepRow, goalStepFingerprint } from "./goal-step-store.js";
import { GoalStepWorker } from "./goal-step-worker.js";

it.each(["goals", "steps"] as const)(
  "stops %s after an outstanding scan without claiming more work",
  async (kind) => {
    let finish!: (rows: { rows: { id: string }[] }) => void;
    const db = {
      query: vi.fn(
        () =>
          new Promise((done) => {
            finish = done;
          }),
      ),
      connect: vi
        .fn()
        .mockRejectedValue(new Error("Unexpected new claim after stop")),
    };
    const worker =
      kind === "goals"
        ? new AgentGoalWorker(db as never, { createDesktopAgentTask: vi.fn() })
        : new GoalStepWorker(db as never, vi.fn());
    const scan = worker.tick();
    let drained = false;
    const stopping = Promise.resolve(worker.stop()).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    finish({ rows: [{ id: "late-goal" }] });
    await Promise.all([scan, stopping]);
    expect(drained).toBe(true);
    expect(db.connect).not.toHaveBeenCalled();
    await worker.tick();
    expect(db.query).toHaveBeenCalledTimes(1);
  },
);

function lockedGoalDb(unlock: () => Promise<unknown>) {
  const release = vi.fn();
  const client = {
    release,
    query: vi.fn(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock"))
        return { rows: [{ locked: true }] };
      if (sql.includes("pg_advisory_unlock")) return unlock();
      return { rows: [] };
    }),
  };
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ id: "goal-with-lock" }] }),
    connect: vi.fn().mockResolvedValue(client),
    release,
  };
}

it("refuses a drained receipt if a goal lock release fails during stop", async () => {
  let rejectUnlock!: (error: Error) => void;
  const unlock = vi.fn(
    () =>
      new Promise((_, reject) => {
        rejectUnlock = reject;
      }),
  );
  const db = lockedGoalDb(unlock);
  const worker = new AgentGoalWorker(db as never, {
    createDesktopAgentTask: vi.fn(),
  });
  const lifecycle = new ServiceLifecycle();
  const receipt = vi.fn();
  lifecycle.onDrain(() => worker.stop());
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const scan = worker.tick();
    await vi.waitFor(() => expect(unlock).toHaveBeenCalledOnce());
    const stopping = lifecycle.drain().then(receipt);
    const rejection = expect(stopping).rejects.toThrow("persist");
    const failure = new Error("unlock connection lost");
    rejectUnlock(failure);
    await Promise.all([scan, rejection]);
    expect(db.release).toHaveBeenCalledWith(failure);
    expect(receipt).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

it("remembers an unresolved goal failure until a later locked scan succeeds", async () => {
  const failure = new Error("unlock connection lost");
  const unlock = vi
    .fn()
    .mockRejectedValueOnce(failure)
    .mockResolvedValue({ rows: [] });
  const db = lockedGoalDb(unlock);
  const worker = new AgentGoalWorker(db as never, {
    createDesktopAgentTask: vi.fn(),
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await worker.tick();
    await expect(worker.stop()).rejects.toThrow("goal");
    worker.start();
    await vi.waitFor(() => expect(unlock).toHaveBeenCalledTimes(2));
    await expect(worker.stop()).resolves.toBeUndefined();
  } finally {
    log.mockRestore();
  }
});

it("does not clear an earlier goal failure when stop prevents the locked replay", async () => {
  let reads = 0;
  let unlocks = 0;
  let entered!: () => void;
  let finish!: (value: { rows: { id: string }[] }) => void;
  const pending = new Promise<{ rows: { id: string }[] }>((resolve) => {
    finish = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock"))
        return { rows: [{ locked: true }] };
      if (sql.includes("pg_advisory_unlock")) {
        if (++unlocks === 1) throw new Error("first cleanup failed");
        return { rows: [] };
      }
      if (++reads === 1) return { rows: [] };
      entered();
      return pending;
    }),
  };
  const db = {
    query: vi.fn().mockResolvedValue({ rows: [{ id: "goal" }] }),
    connect: vi.fn().mockResolvedValue(client),
  };
  const worker = new AgentGoalWorker(db as never, {
    createDesktopAgentTask: vi.fn(),
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await worker.tick();
    const retry = worker.tick();
    await waiting;
    const stopping = worker.stop();
    const rejection = expect(stopping).rejects.toThrow("goal");
    finish({ rows: [{ id: "goal" }] });
    await Promise.all([retry, rejection]);
  } finally {
    log.mockRestore();
  }
});

function stepDrainFixture(failRecovery: boolean) {
  const goal = {
    id: "step-goal",
    created_by: "owner",
    workspace_id: "workspace",
    canvas_id: null,
    chat_session_id: null,
    goal: "read a source",
    plan: { version: 2, steps: [] },
    execution_mode: "automatic",
    output_kind: "document",
  };
  const command = { executor: "web.search", query: "fixture" } as const;
  const step: GoalStepRow = {
    id: "step-row",
    goal_id: goal.id,
    step_id: "read",
    title: "Read",
    executor: command.executor,
    command,
    depends_on: [],
    state: "queued",
    attempt: 0,
    fingerprint: goalStepFingerprint(goal.id, "read", command),
    approval: "not_required",
    approval_expires_at: null,
    lease_token: null,
    output: null,
    error: null,
  };
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("select * from agent_goals")) return { rows: [goal] };
    if (
      sql.includes("from agent_goal_steps") &&
      sql.includes("order by ordinal")
    )
      return { rows: [step] };
    if (sql.includes("attempt=attempt+case"))
      return { rows: [{ ...step, state: "running", lease_token: "lease" }] };
    if (sql.includes("set state=$3,error=$4") && failRecovery)
      throw new Error("recovery write failed");
    if (
      sql.startsWith("select id from agent_goals") ||
      sql.includes("update agent_goal_steps s set lease_until")
    )
      return { rows: [{ id: goal.id }] };
    return { rows: [] };
  });
  const db = { query, connect: vi.fn().mockResolvedValue({ query, release }) };
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const worker = new GoalStepWorker(db as never, async ({ signal }) => {
    started();
    return new Promise((_, reject) =>
      signal.addEventListener(
        "abort",
        () => reject(new Error("service draining")),
        { once: true },
      ),
    );
  });
  return { worker, entered, query };
}

it.each([false, true])(
  "only reports step drain when interruption recovery is saved (failure=%s)",
  async (failed) => {
    const { worker, entered, query } = stepDrainFixture(failed);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const scan = worker.tick();
      await entered;
      if (failed) await expect(worker.stop()).rejects.toThrow("step");
      else await expect(worker.stop()).resolves.toBeUndefined();
      await scan;
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("set state=$3,error=$4"),
        expect.arrayContaining(["queued"]),
      );
      if (failed) await expect(worker.stop()).rejects.toThrow("step");
    } finally {
      log.mockRestore();
    }
  },
);

it("does not clear a step persistence failure when a later scan cannot claim the task", async () => {
  const { worker, entered, query } = stepDrainFixture(true);
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const scan = worker.tick();
    await entered;
    await expect(worker.stop()).rejects.toThrow("step");
    await scan;
    query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith("select * from agent_goals")
        ? [{ id: "step-goal" }]
        : [],
    }));
    worker.start();
    await vi.waitFor(() =>
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("skip locked"),
        ["step-goal"],
      ),
    );
    await expect(worker.stop()).rejects.toThrow("step");
  } finally {
    log.mockRestore();
  }
});
