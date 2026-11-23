import Fastify from "fastify";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), createJob: vi.fn(), charge: vi.fn() }));
vi.mock("../features/generation/generation-approval-service.js", async original => ({ ...await original<object>(), createGenerationApprovalService: () => ({ gate: mocks.gate }) }));
vi.mock("../features/agent-goals/connector-gate.js", async original => ({ ...await original<object>(), assertConnectorEnabled: async () => undefined }));
vi.mock("./model-availability.js", () => ({ resolveConfiguredModel: async () => ({ model_id: "hailuo-h3", supports_audio: false, requires_input_image: true }) }));
import { registerJobRoutes } from "./jobs.js";
import { getModelCallProfile } from "../local-db/model-call-profiles.js";

it("uses signed reference URLs for Hailuo on the configured media API", () => {
  expect(getModelCallProfile("hailuo-h3", "lingke_media")).toMatchObject({ inputImageTransport: "provider_url", requiresPublicImageUrl: true });
});

it("rejects a missing first frame before approval, job creation or debit", async () => {
  const app = Fastify();
  await registerJobRoutes(app, {
    auth: { authenticate: async () => ({ id: "user" }) } as never,
    viewerService: { ensureViewer: async () => ({ workspace: { id: "workspace" } }) } as never,
    jobService: { createJob: mocks.createJob } as never,
    creditService: { deductCredits: mocks.charge } as never,
    localDb: { query: async () => ({ rows: [] }) } as never,
  });
  try {
    const response = await app.inject({ method: "POST", url: "/api/jobs/video-generation", payload: { model: "hailuo-h3", prompt: "A lamp", duration: 4 } });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatchObject({ code: "invalid_input", message: expect.stringContaining("首帧") });
    expect(mocks.gate).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.charge).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
