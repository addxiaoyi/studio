import { expect, it, vi } from "vitest";
import { executeLogicNode } from "./logic-executor.js";
import {
  StepWaiting,
  type StepExecution,
} from "../agent-goals/goal-step-worker.js";
import { shouldSkipStep } from "../agent-goals/step-routing.js";
const input = (command: unknown, output: unknown, checkpoint: unknown = null) =>
  ({
    step: { step_id: "batch", command, output: checkpoint },
    previous: [{ step_id: "input", state: "succeeded", output }],
    goal: { plan: { steps: [] } },
    signal: new AbortController().signal,
    assertActive: vi.fn(),
  }) as unknown as StepExecution;
const batch = {
  executor: "flow.batch",
  fromStep: "input",
  maxItems: 3,
  batchSize: 2,
  operations: [{ kind: "template", template: "{{index}}: {{text}}" }],
};
it("splits real lists, checkpoints batches and resumes without duplicate items", async () => {
  const source = await executeLogicNode(
    input(
      {
        executor: "data.split",
        fromStep: "input",
        source: "json",
        path: "rows",
        separator: "\n",
        maxItems: 3,
      },
      { json: { rows: ["a", "b", "c"] } },
    ),
  );
  let checkpoint: Record<string, unknown> | undefined;
  try {
    await executeLogicNode(input(batch, source));
  } catch (error) {
    expect(error).toBeInstanceOf(StepWaiting);
    checkpoint = (error as StepWaiting).output;
  }
  expect(checkpoint).toMatchObject({ processed: 2, total: 3 });
  expect(
    await executeLogicNode(input(batch, source, checkpoint)),
  ).toMatchObject({ items: ["1: a", "2: b", "3: c"], processed: 3, total: 3 });
  expect(await executeLogicNode(input(batch, { items: [] }))).toMatchObject({
    items: [],
    processed: 0,
    total: 0,
  });
});
it("rejects over-limit input before processing and rejects stale checkpoints", async () => {
  await expect(
    executeLogicNode(input(batch, { items: [1, 2, 3, 4] })),
  ).rejects.toThrow(/上限/);
  await expect(
    executeLogicNode(
      input(
        batch,
        { items: [1] },
        { processed: 1, items: ["forged"], inputHash: "changed" },
      ),
    ),
  ).rejects.toThrow(/回执|变化/);
});
it("matches Switch in order, supports all matches, and executes default only when none match", async () => {
  const command = {
    executor: "flow.switch",
    fromStep: "input",
    mode: "first",
    cases: [
      {
        id: "a",
        title: "A",
        match: "all",
        conditions: [{ field: "text", operator: "contains", value: "hello" }],
      },
      {
        id: "b",
        title: "B",
        match: "all",
        conditions: [{ field: "text", operator: "not_empty", value: "" }],
      },
    ],
  };
  expect(
    await executeLogicNode(input(command, { text: "hello" })),
  ).toMatchObject({ branches: ["a"] });
  expect(
    await executeLogicNode(
      input({ ...command, mode: "all" }, { text: "hello" }),
    ),
  ).toMatchObject({ branches: ["a", "b"] });
  expect(await executeLogicNode(input(command, { text: "" }))).toMatchObject({
    branches: ["default"],
  });
  const plan = {
    steps: [
      { id: "route", command },
      { id: "paid", when: [{ source: "route", branch: "default" }] },
    ],
  };
  expect(
    shouldSkipStep(
      plan as never,
      {
        step_id: "paid",
        executor: "media.generate",
        depends_on: ["route"],
      } as never,
      [
        { step_id: "route", state: "succeeded", output: { branches: ["a"] } },
      ] as never,
    ),
  ).toBe(true);
});
it("stops a batch immediately when the execution lease is revoked", async () => {
  const execution = input(batch, { items: ["a", "b"] });
  execution.assertActive = vi.fn().mockRejectedValue(new Error("执行已撤销"));
  await expect(executeLogicNode(execution)).rejects.toThrow("撤销");
  expect(execution.assertActive).toHaveBeenCalledOnce();
});
