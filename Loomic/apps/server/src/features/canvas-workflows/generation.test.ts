import { expect, it, vi, beforeEach } from "vitest";
import { executeWorkflowGeneration } from "./generation.js";
import {
  StepWaiting,
  type StepExecution,
} from "../agent-goals/goal-step-worker.js";
import {
  assertWorkflowGenerationActive,
  assertWorkflowJobGenerationActive,
} from "./approval-access.js";
const gate = vi.hoisted(() => vi.fn());
vi.mock("../generation/generation-approval-service.js", async (original) => ({
  ...(await original<object>()),
  createGenerationApprovalService: () => ({ gate }),
}));
vi.mock("../../http/model-availability.js", () => ({
  resolveConfiguredModel: vi.fn().mockResolvedValue({
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

it("does not silently omit a missing source or an unprocessed video reference", async () => {
  const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  await expect(
    executeWorkflowGeneration(
      db as never,
      { ...input, previous: [] },
      command as never,
    ),
  ).rejects.toThrow("上游");
  const videoInput = {
    ...input,
    previous: [
      {
        step_id: "story",
        output: { assets: [{ id: "video", mediaType: "video" }] },
      },
    ],
  } as unknown as StepExecution;
  await expect(
    executeWorkflowGeneration(db as never, videoInput, command as never),
  ).rejects.toThrow("抽帧");
  expect(gate).not.toHaveBeenCalled();
});

it("refuses a deleted reference before creating a fee confirmation", async () => {
  const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  const referenceInput = {
    ...input,
    previous: [
      {
        step_id: "story",
        output: {
          assets: [
            { id: "f6eec59d-3554-4d5d-a85f-06cdc51c2b56", mediaType: "image" },
          ],
        },
      },
    ],
  } as unknown as StepExecution;
  await expect(
    executeWorkflowGeneration(db as never, referenceInput, command as never),
  ).rejects.toThrow("参考素材");
  expect(gate).not.toHaveBeenCalled();
});

it("quotes the exact saved reference images that will reach the model", async () => {
  const assetId = "f6eec59d-3554-4d5d-a85f-06cdc51c2b56";
  const db = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: assetId }] }),
  };
  const withReference = {
    ...input,
    previous: [
      {
        step_id: "story",
        output: {
          text: "保留角色",
          assets: [{ id: assetId, mediaType: "image" }],
        },
      },
    ],
  } as unknown as StepExecution;
  gate.mockResolvedValue({
    state: "confirmation_required",
    request: {
      approvalId: "reference-approval",
      parameters: {},
      model: "image-model",
      estimatedCredits: 1,
    },
  });
  await expect(
    executeWorkflowGeneration(db as never, withReference, command as never),
  ).rejects.toMatchObject({
    output: {
      generationPreview: {
        inputAssetIds: [assetId],
        prompt: "自然光\n\n保留角色",
      },
    },
  });
  expect(gate).toHaveBeenCalledWith(
    expect.objectContaining({
      forceConfirmation: true,
      payload: expect.objectContaining({
        input_asset_ids: [assetId],
        routing: expect.objectContaining({
          inputImage: true,
          selectedModel: "image-model",
        }),
      }),
    }),
  );
});

it("checks the consumed quote again when a queued media job reaches the provider", async () => {
  const job = {
    jobId: "job",
    stepId: "step",
    workspaceId: "workspace",
    userId: "user",
  };
  await expect(
    assertWorkflowJobGenerationActive(
      { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
      job,
    ),
  ).rejects.toThrow("已消费费用确认");
  const db = {
    query: vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            model: "image-model",
            payload: {},
            context: { workflowGoalId: "goal", workflowStepId: "step" },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }),
  };
  await expect(
    assertWorkflowJobGenerationActive(db as never, job),
  ).rejects.toThrow("暂停、取消");
});
