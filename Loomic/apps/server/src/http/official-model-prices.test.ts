import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { dedupeWorkspaceModelPrices, registerOfficialModelPriceRoutes } from "./official-model-prices.js";

const activeRows = [
  {
    model_id: "gpt-image-2", display_name: "GPT Image 2", media_type: "image", billing_unit: "per_generation",
    price_credits: 0.1, input_token_price_cny: null, output_token_price_cny: null,
    model_enabled: true, provider_enabled: true, model_health: "healthy", provider_health: "healthy", provider_label: "Image Provider",
  },
  {
    model_id: "video-model", display_name: "Video Model", media_type: "video", billing_unit: "per_second",
    price_credits: 0.45, input_token_price_cny: null, output_token_price_cny: null,
    model_enabled: true, provider_enabled: true, model_health: "healthy", provider_health: "healthy", provider_label: "Video Provider",
  },
  {
    model_id: "agent-model", display_name: "Agent Model", media_type: "image", billing_unit: "per_million_tokens",
    price_credits: 0, input_token_price_cny: 0.4, output_token_price_cny: 0.8,
    model_enabled: true, provider_enabled: true, model_health: "healthy", provider_health: "healthy", provider_label: "Token Provider",
  },
  {
    model_id: "google/nano-banana-pro", display_name: "Nano Banana Pro", media_type: "image", billing_unit: "per_generation",
    price_credits: 0.1, input_token_price_cny: null, output_token_price_cny: null,
    model_enabled: true, provider_enabled: true, model_health: "healthy", provider_health: "healthy", provider_label: "Retired Provider",
  },
];

describe("workspace model pricing route", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("requires authentication and never queries workspace models anonymously", async () => {
    const db = { query: vi.fn() } as unknown as Pool;
    const app = Fastify();
    apps.push(app);
    registerOfficialModelPriceRoutes(app, {
      db,
      autoSync: false,
      auth: { authenticate: vi.fn().mockResolvedValue(null) },
      viewerService: { ensureViewer: vi.fn() } as never,
    });

    const response = await app.inject({ method: "GET", url: "/api/workspace/model-prices" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ authenticated: false, models: [] });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("returns all model mappings from only the authenticated workspace with user prices", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: activeRows }) } as unknown as Pool;
    const ensureViewer = vi.fn().mockResolvedValue({ workspace: { id: "workspace-current" } });
    const app = Fastify();
    apps.push(app);
    registerOfficialModelPriceRoutes(app, {
      db,
      autoSync: false,
      auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-current", email: "user@example.com", accessToken: "", userMetadata: {} }) },
      viewerService: { ensureViewer } as never,
    });

    const response = await app.inject({ method: "GET", url: "/api/workspace/model-prices" });
    const payload = response.json();
    expect(response.statusCode).toBe(200);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("pc.workspace_id=$1"), ["workspace-current"]);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("pm.enabled=true"), ["workspace-current"]);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("pc.enabled=true"), ["workspace-current"]);
    expect(payload.data.authenticated).toBe(true);
    expect(payload.data.models).toHaveLength(2);
    expect(payload.data.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: "gpt-image-2", priceCny: 0.1, billingUnit: "per_generation" }),
      expect.objectContaining({ modelId: "video-model", priceCny: 0.45, billingUnit: "per_second" }),
    ]));
    expect(payload.data.models.some((model: { modelId: string }) => model.modelId === "agent-model")).toBe(false);
    expect(payload.data.models.some((model: { modelId: string }) => model.modelId.includes("nano-banana"))).toBe(false);
  });

  it("deduplicates workspace mappings by normalized media type and model id", () => {
    const models = [
      { modelId: " MiniMax-H3 ", mediaType: "video", billingUnit: "per_second", providerLabel: "first" },
      { modelId: "minimax-h3", mediaType: "video", billingUnit: "per_second", providerLabel: "second" },
    ] as never[];

    expect(dedupeWorkspaceModelPrices(models)).toHaveLength(1);
    expect(dedupeWorkspaceModelPrices(models)[0]?.providerLabel).toBe("first");
  });
});
