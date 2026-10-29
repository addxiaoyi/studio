import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

const { healthyRows, availabilityRows } = vi.hoisted(() => ({
  healthyRows: vi.fn(),
  availabilityRows: vi.fn(),
}));

vi.mock("./model-availability.js", () => ({
  listHealthyModels: healthyRows,
  listModelAvailability: availabilityRows,
  minimumCreditCost: vi.fn(() => 1),
}));
vi.mock("../generation/providers/registry.js", () => ({ getAvailableVideoModels: vi.fn(() => []) }));

import { registerVideoModelRoutes } from "./video-models.js";

const row = (model_id: string, health_status: "healthy" | "unhealthy" = "healthy") => ({
  model_id,
  display_name: model_id,
  billing_unit: "per_second" as const,
  price_credits: 1,
  input_token_price_cny: null,
  output_token_price_cny: null,
  supports_input_image: true,
  supports_input_video: false,
  supports_audio: true,
  max_duration_seconds: 10,
  max_resolution: "1080p",
  health_status,
  failure_count: 0,
  cooldown_until: null,
  provider_health_status: "healthy",
  availability: health_status === "healthy" ? "available" as const : "unavailable" as const,
  availability_reason: health_status === "healthy" ? null : "offline",
});

describe("video model route retirement filter", () => {
  afterEach(() => vi.clearAllMocks());

  it("filters retired configured models from available and unavailable response lists", async () => {
    const rows = [row("minimax-h3"), row("MiniMax-H3"), row("gk-video-3"), row("grok-imagine-video-1.5-preview"), row("high_aes_general_v30l_zt2i")];
    healthyRows.mockResolvedValue(rows);
    availabilityRows.mockResolvedValue(rows);
    const app = Fastify();
    await registerVideoModelRoutes(app, {
      auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) } as never,
      viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }) } as never,
      creditService: { getBalance: vi.fn().mockResolvedValue({ balance: 10 }) } as never,
      localDb: {} as never,
    });
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/api/video-models" });
    const body = response.json() as { models: Array<{ id: string; creditCost: number; providerPriceCny: number; resolutionRates?: Array<{ resolution: string; priceCnyPerSecond: number }> }>; unavailableModels: Array<{ id: string }> };
    const returnedIds = [...body.models, ...body.unavailableModels].map((model) => model.id);
    expect(response.statusCode).toBe(200);
    expect(returnedIds).toContain("minimax-h3");
    expect(returnedIds).not.toContain("MiniMax-H3");
    expect(body.models.find((model) => model.id === "minimax-h3")).toMatchObject({
      creditCost: 0.3,
      providerPriceCny: 0.3,
      resolutionRates: [
      { resolution: "480p", priceCnyPerSecond: 0.22 },
      { resolution: "768p", priceCnyPerSecond: 0.3 },
      { resolution: "1088p", priceCnyPerSecond: 0.34 },
      { resolution: "1440p", priceCnyPerSecond: 0.38 },
      ],
    });
    expect(returnedIds).not.toContain("gk-video-3");
    expect(returnedIds).not.toContain("grok-imagine-video-1.5-preview");
    expect(returnedIds).not.toContain("high_aes_general_v30l_zt2i");
    await app.close();
  });
});
