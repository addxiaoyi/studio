import { expect, it, vi, beforeEach } from "vitest";
import { executeWorkflowGeneration } from "./generation.js";
import {
  StepWaiting,
  type StepExecution,
} from "../agent-goals/goal-step-worker.js";
import { assertWorkflowGenerationActive } from "./approval-access.js";
const gate = vi.hoisted(() => vi.fn());
vi.mock("../generation/generation-approval-service.js", async (original) => ({
  ...(await original<object>()),
  createGenerationApprovalService: () => ({ gate }),
}));
vi.mock("../../http/model-availability.js", () => ({
  resolveConfiguredModel: vi
    .fn()
    .mockResolvedValue({
      model_id: "image-model",
      display_name: "Image",
      billing_unit: "per_generation",
      price_credits: 1,
      supports_input_image: true,
    }),
}));
vi.mock("../agent-goals/connector-gate.js", () => ({
  assertConnectorEnabled: vi.fn(),
}));
const command = {
  executor: "media.generate",
  sources: ["story"],
  mediaType: "image",
  model: "image-model",
  prompt: "自然光",
  aspectRatio: "16:9",
  duration: 5,
  resolution: "720p",
} as const;
const input = {
  goal: {
    id: "goal",
    workspace_id: "workspace",
    created_by: "user",
    canvas_id: "canvas",
    chat_session_id: "session",
  },
  step: { id: "step", title: "生成场景", command, output: null },
  previous: [{ step_id: "story", output: { text: "山间木屋" } }],
  assertActive: async () => {},
  signal: new AbortController().signal,
} as unknown as StepExecution;
beforeEach(() => vi.clearAllMocks());
it("always quotes exact inputs without creating or debiting a job", async () => {
  gate.mockResolvedValue({
    state: "confirmation_required",
    request: {
      approvalId: "approval",
      parameters: { private: true },
      model: "image-model",
      estimatedCredits: 1,
    },
  });
  const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  await expect(
    executeWorkflowGeneration(db as never, input, command as never),
  ).rejects.toBeInstanceOf(StepWaiting);
  expect(gate).toHaveBeenCalledWith(
    expect.objectContaining({
      forceConfirmation: true,
      context: expect.objectContaining({
        workflowGoalId: "goal",
        workflowStepId: "step",
      }),
      payload: expect.objectContaining({
        prompt: "自然光\n\n山间木屋",
        workflow_step_id: "step",
      }),
    }),
  );
  expect(
    db.query.mock.calls.some(([sql]) => /insert|update|delete/i.test(sql)),
  ).toBe(false);
});
it("restores a completed job without submitting or charging again", async () => {
  const db = {
    query: vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: "approval", status: "approved", job_id: "job" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            status: "succeeded",
            result: { asset_id: "asset", canvas_element_id: "element" },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: "asset" }] }),
  };
  const output = await executeWorkflowGeneration(
    db as never,
    input,
    command as never,
  );
  expect(output).toMatchObject({
    generationJobId: "job",
    canvasElementIds: ["element"],
    assets: [{ id: "asset", mediaType: "image" }],
  });
  expect(gate).not.toHaveBeenCalled();
});
it("rejects a canceled generation and a stopped workflow confirmation", async () => {
  await expect(
    executeWorkflowGeneration(
      {
        query: vi.fn().mockResolvedValue({ rows: [{ status: "rejected" }] }),
      } as never,
      input,
      command as never,
    ),
  ).rejects.toThrow("拒绝");
  await expect(
    assertWorkflowGenerationActive(
      { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
      {
        model: "image-model",
        context: { workflowGoalId: "goal", workflowStepId: "step" },
      } as never,
    ),
  ).rejects.toThrow("暂停、取消");
});
