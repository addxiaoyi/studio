import { expect, it, vi } from "vitest";
import { guardWorkflowExecution } from "./execution-access.js";
it("stops a running workflow when canvas access is revoked before the next step action", async () => {
  const db = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValue({ rows: [{ allowed: false }] }),
  };
  const effect = vi.fn();
  const execute = guardWorkflowExecution(db as never, async (input) => {
    await input.assertActive();
    effect();
    return {};
  });
  await expect(
    execute({
      goal: { id: "goal", created_by: "user" },
      assertActive: async () => {},
    } as never),
  ).rejects.toThrow("权限已撤销");
  expect(effect).not.toHaveBeenCalled();
});
