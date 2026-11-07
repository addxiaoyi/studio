import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { registerJobRoutes } from "./jobs.js";
import { CONFIGURED_PRICE_MULTIPLIER } from "@helstera/shared";
const { gate, resolveModel } = vi.hoisted(() => ({
  gate: vi.fn(),
  resolveModel: vi.fn(),
}));
vi.mock(
  "../features/generation/generation-approval-service.js",
  async (original) => ({
    ...(await original<
      typeof import("../features/generation/generation-approval-service.js")
    >()),
    createGenerationApprovalService: () => ({ gate }),
  }),
);
vi.mock("../features/agent-goals/connector-gate.js", async (original) => ({
  ...(await original<
    typeof import("../features/agent-goals/connector-gate.js")
  >()),
  assertConnectorEnabled: async () => undefined,
}));
vi.mock("./model-availability.js", () => ({
  resolveConfiguredModel: resolveModel,
}));
it("binds try-on approval to the selected image model and both private references", async () => {
  resolveModel.mockResolvedValue({
    model_id: "chosen-image",
    supports_input_image: true,
    billing_unit: "per_generation",
    price_credits: 3.5 / CONFIGURED_PRICE_MULTIPLIER,
  });
  gate.mockResolvedValue({
    state: "confirmation_required",
    request: { approvalId: "quote", estimatedCredits: 3.5 },
  });
  const createJob = vi.fn(),
    deductCredits = vi.fn(),
    app = Fastify();
  await registerJobRoutes(app, {
    auth: { authenticate: async () => ({ id: "u" }) } as never,
    viewerService: {
      ensureViewer: async () => ({ workspace: { id: "w" } }),
    } as never,
    localDb: { query: async () => ({ rows: [] }) } as never,
    jobService: { createJob } as never,
    creditService: { deductCredits } as never,
    tierGuard: {
      checkModelAccess: async () => {},
      checkConcurrency: async () => {},
      // A different provider with the same model ID must not set this quote.
      calculateCreditCost: async () => 7,
    } as never,
  });
  try {
    const input = {
      purpose: "try-on",
      model: "chosen-image",
      prompt: "试穿",
      input_asset_ids: [
        "123e4567-e89b-42d3-a456-426614174000",
        "123e4567-e89b-42d3-a456-426614174001",
      ],
    };
    const reply = await app.inject({
      method: "POST",
      url: "/api/jobs/image-generation",
      payload: input,
    });
    expect(reply.statusCode).toBe(409);
    expect(resolveModel).toHaveBeenCalledWith(
      expect.anything(),
      "image",
      "chosen-image",
      expect.objectContaining({
        requiresInputImage: true,
        strictRequested: true,
      }),
    );
    expect(gate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "chosen-image",
        forceConfirmation: true,
        estimatedCredits: 3.5,
        payload: expect.objectContaining({
          purpose: "try-on",
          input_asset_ids: input.input_asset_ids,
        }),
      }),
    );
    expect(createJob).not.toHaveBeenCalled();
    expect(deductCredits).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/jobs/image-generation",
          payload: { ...input, input_asset_ids: [] },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
