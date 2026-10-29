import { describe, expect, it, vi } from "vitest";

import {
  listModelAvailability,
  minimumCreditCost,
  resolveConfiguredModel,
  type AvailableProviderModel,
} from "./model-availability.js";

const baseModel: AvailableProviderModel = {
  model_id: "video-model",
  display_name: "MiniMax H3",
  billing_unit: "per_generation",
  price_credits: 1,
  input_token_price_cny: null,
  output_token_price_cny: null,
  supports_input_image: true,
  max_duration_seconds: 10,
  health_status: "healthy",
};

function dbWith(models: AvailableProviderModel[]) {
  return {
    query: vi.fn((_sql: string, params: unknown[]) => ({
      rows: models,
    })),
  } as never;
}

describe("resolveConfiguredModel", () => {
  it("uses the configured minimum resolution price for multi-resolution video models", () => {
    expect(minimumCreditCost({
      ...baseModel,
      model_id: "minimax-h3",
      billing_unit: "per_second",
      price_credits: 0.432,
    })).toBeCloseTo(0.22);
  });

  it("allows an explicitly requested degraded model while the provider remains healthy", async () => {
    const model = await resolveConfiguredModel(dbWith([{
      ...baseModel,
      model_id: "video-model",
      health_status: "degraded",
      failure_count: 2,
      supports_input_image: true,
    }]), "video", "video-model", {
      strictRequested: true,
      requiresInputImage: true,
    });

    expect(model?.model_id).toBe("video-model");
  });
  it("allows an explicitly selected unverified video model", async () => {
    const model = await resolveConfiguredModel(dbWith([{
      ...baseModel,
      health_status: "unknown",
      supports_input_image: true,
    }]), "video", "video-model", {
      strictRequested: true,
      allowUnverified: true,
      requiresInputImage: true,
    });

    expect(model?.model_id).toBe("video-model");
  });
  it("falls back within the user's selected models when the requested model is unavailable", async () => {
    const model = await resolveConfiguredModel(dbWith([baseModel]), "video", "omni-flash", {
      requiresInputImage: true,
      allowedModelIds: ["omni-flash", "video-model"],
    });

    expect(model?.model_id).toBe("video-model");
  });

  it("never falls back to a model outside the user's selection", async () => {
    const model = await resolveConfiguredModel(dbWith([baseModel]), "video", "omni-flash", {
      requiresInputImage: true,
      allowedModelIds: ["omni-flash"],
    });

    expect(model).toBeNull();
  });

  it("keeps the agent-requested model when it remains available", async () => {
    const requested = { ...baseModel, model_id: "omni-flash", display_name: "Omni Flash" };
    const model = await resolveConfiguredModel(dbWith([baseModel, requested]), "video", "omni-flash", {
      requiresInputImage: true,
      allowedModelIds: ["video-model", "omni-flash"],
    });

    expect(model?.model_id).toBe("omni-flash");
  });

  it("matches configured model IDs case-insensitively", async () => {
    const configured = { ...baseModel, model_id: "Video-Model" };
    const model = await resolveConfiguredModel(dbWith([configured]), "video", "video-model", { strictRequested: true });
    expect(model?.model_id).toBe("Video-Model");
  });

  it("rejects an unavailable requested model in strict mode", async () => {
    const model = await resolveConfiguredModel(dbWith([baseModel]), "video", "missing-model", { strictRequested: true });
    expect(model).toBeNull();
  });

  it("does not route image generation through degraded mappings", async () => {
    const degraded = {
      ...baseModel,
      model_id: "gpt-image-2.5-2k",
      health_status: "degraded" as const,
      supports_input_image: true,
    };
    const healthy = {
      ...baseModel,
      model_id: "gpt-image-2",
      health_status: "healthy" as const,
      supports_input_image: true,
    };

    const model = await resolveConfiguredModel(
      dbWith([degraded, healthy]),
      "image",
      degraded.model_id,
      { requiresInputImage: true },
    );

    expect(model?.model_id).toBe(healthy.model_id);
  });

  it("never exposes or routes a retired image model from dynamic provider data", async () => {
    const removed = { ...baseModel, model_id: "openai/gpt-image-1", display_name: "retired" };
    const model = await resolveConfiguredModel(dbWith([removed, baseModel]), "image", removed.model_id);
    expect(model?.model_id).toBe("video-model");
    await expect(listModelAvailability(dbWith([removed, baseModel]), "image"))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ model_id: "video-model" })]));
    await expect(listModelAvailability(dbWith([removed]), "image")).resolves.toEqual([]);
    await expect(listModelAvailability(dbWith([removed]), "video")).resolves.toEqual([]);
  });

  it.each(["doubao-seededit-3-0-i2i-250628", "high_aes_general_v30l_zt2i"])(
    "never falls back to retired image model %s",
    async (retiredId) => {
      const removed = { ...baseModel, model_id: retiredId, display_name: "retired" };
      const model = await resolveConfiguredModel(dbWith([removed, baseModel]), "image", retiredId);
      expect(model?.model_id).toBe("video-model");
      await expect(listModelAvailability(dbWith([removed]), "image")).resolves.toEqual([]);
    },
  );

  it("does not route text-to-image requests to an upscaler", async () => {
    const upscaler = { ...baseModel, model_id: "gpt-image-2-4k-超分", display_name: "超清放大" };
    const generator = { ...baseModel, model_id: "gpt-image-2-4k", display_name: "GPT Image 2 4K" };
    const model = await resolveConfiguredModel(dbWith([upscaler, generator]), "image", "gpt-image-2", {
      requiresInputImage: false,
    });

    expect(model?.model_id).toBe("gpt-image-2-4k");
  });
});

describe("listModelAvailability", () => {
  it("removes token-billed video models from listing and generation resolution", async () => {
    const tokenVideo = {
      ...baseModel,
      model_id: "seedance-2.5-guanfang",
      billing_unit: "per_million_tokens" as const,
      input_token_price_cny: 10,
      output_token_price_cny: 10,
    };
    await expect(listModelAvailability(dbWith([tokenVideo]), "video")).resolves.toEqual([]);
    await expect(resolveConfiguredModel(dbWith([tokenVideo]), "video", tokenVideo.model_id, { strictRequested: true })).resolves.toBeNull();
  });

  it("does not apply the video token removal rule to image models", async () => {
    const tokenImage = {
      ...baseModel,
      model_id: "token-image",
      billing_unit: "per_million_tokens" as const,
      input_token_price_cny: 10,
      output_token_price_cny: 10,
    };
    await expect(listModelAvailability(dbWith([tokenImage]), "image")).resolves.toHaveLength(1);
  });

  it("excludes models above the public three-yuan unit price limit", async () => {
    const expensive = { ...baseModel, billing_unit: "per_generation" as const, price_credits: 3.01 };
    await expect(listModelAvailability(dbWith([expensive]), "image")).resolves.toEqual([]);
    await expect(listModelAvailability(dbWith([{ ...baseModel, billing_unit: "per_second" as const, price_credits: 3.01 }]), "video")).resolves.toEqual([]);
    await expect(listModelAvailability(dbWith([{ ...baseModel, billing_unit: "per_second" as const, price_credits: 3 }]), "video")).resolves.toHaveLength(1);
  });

  it("returns a safe balance status without exposing the upstream response", async () => {
    const [model] = await listModelAvailability(dbWith([{
      ...baseModel,
      health_status: "degraded",
      provider_health_status: "healthy",
      last_error: "HTTP 402 当前余额=0.01 secret upstream payload",
    }]), "video");

    expect(model?.availability).toBe("unavailable");
    expect(model?.availability_reason).toBe("上游额度不足，等待恢复");
    expect(model?.availability_reason).not.toContain("secret");
  });

  it("marks a healthy model as selectable", async () => {
    const [model] = await listModelAvailability(dbWith([{
      ...baseModel,
      provider_health_status: "healthy",
    }]), "video");

    expect(model?.availability).toBe("available");
    expect(model?.availability_reason).toBeNull();
  });
});
