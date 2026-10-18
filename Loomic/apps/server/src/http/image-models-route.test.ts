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
vi.mock("../generation/providers/registry.js", () => ({ getAvailableImageModels: vi.fn(() => []) }));

import { registerImageModelRoutes } from "./image-models.js";

const row = (model_id: string, health_status: "healthy" | "unhealthy" = "healthy") => ({
  model_id,
  display_name: model_id,
  billing_unit: "per_generation" as const,
  price_credits: 1,
  input_token_price_cny: null,
  output_token_price_cny: null,
  supports_input_image: false,
  health_status,
  failure_count: 0,
  cooldown_until: null,
  provider_health_status: "healthy",
  availability: health_status === "healthy" ? "available" as const : "unavailable" as const,
  availability_reason: health_status === "healthy" ? null : "offline",
});

describe("image model route retirement filter", () => {
  afterEach(() => vi.clearAllMocks());

  it("filters retired configured models from available and unavailable response lists", async () => {
    const rows = [
      row("doubao-seedream-3-0-t2i-250415"),
      row("doubao-seededit-3-0-i2i-250628"),
      row("gpt-image-1.5"),
      row("gpt-image-2"),
    ];
    healthyRows.mockResolvedValue(rows);
    availabilityRows.mockResolvedValue(rows);
    const app = Fastify();
    await registerImageModelRoutes(app, {
      auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) } as never,
      viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-1" } }) } as never,
      creditService: { getBalance: vi.fn().mockResolvedValue({ balance: 10 }) } as never,
      localDb: {} as never,
    });
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/api/image-models" });
    const body = response.json() as { models: Array<{ id: string }>; unavailableModels: Array<{ id: string }> };
    const returnedIds = [...body.models, ...body.unavailableModels].map((model) => model.id);
    expect(response.statusCode).toBe(200);
    expect(returnedIds).toContain("doubao-seedream-3-0-t2i-250415");
    expect(returnedIds).toContain("gpt-image-2");
    expect(returnedIds).not.toContain("doubao-seededit-3-0-i2i-250628");
    expect(returnedIds).not.toContain("gpt-image-1.5");
    await app.close();
  });
});
