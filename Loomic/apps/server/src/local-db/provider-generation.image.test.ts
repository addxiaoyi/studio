import { createCipheriv, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { generateConfiguredImage } from "./provider-generation.js";
import { sanitizeErrorForClient } from "../utils/error-sanitizer.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("stops a refused request without poisoning model health or submitting to another channel", async () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update("test-only"), cipher.final()]);
  vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", key.toString("base64"));
  const channel = {
    id: "first", provider_model_id: "image-model",
    base_url: "https://provider.test/v1", api_format: "openai",
    key_ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64"),
  };
  const query = vi.fn().mockResolvedValue({ rows: [channel, { ...channel, id: "second" }] });
  const request = vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ error: { message: "该请求可能因安全政策被拦截" } }), { status: 400 },
  ));
  vi.stubGlobal("fetch", request);
  await expect(generateConfiguredImage({ query } as unknown as Pool, "gpt-image-2", { model: "gpt-image-2", prompt: "test" }))
    .rejects.toMatchObject({ code: "safety_filter" });
  expect(request).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledTimes(1);
});

it("requires an input-capable provider mapping for reference images", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });

  await expect(generateConfiguredImage({ query } as unknown as Pool, "gpt-image-2", {
    model: "gpt-image-2",
    prompt: "edit",
    inputImages: ["data:image/png;base64,cGlj"],
  })).resolves.toBeNull();

  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("pm.supports_input_image = true"),
    ["gpt-image-2", true, false],
  );
});

it("preserves a wrapped refusal as a safe actionable client message", () => {
  const wrapped = Object.assign(new Error("Image generation failed for model gpt-image-2: upstream body"), { code: "safety_filter" });
  const message = sanitizeErrorForClient(wrapped);
  expect(message).toContain("上游拒绝");
  expect(message).toContain("不会自动重试");
  expect(message).not.toContain("upstream body");
  expect(message).not.toContain("不兼容");
});

it.each([502, 504])("does not submit to another paid channel after HTTP %s", async (status) => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update("test-only"), cipher.final()]);
  vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", key.toString("base64"));
  const channel = {
    id: "first", provider_model_id: "image-model",
    base_url: "https://provider.test/v1", api_format: "openai",
    key_ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64"),
  };
  const query = vi.fn().mockResolvedValue({ rows: [channel, { ...channel, id: "second" }] });
  const request = vi.fn().mockResolvedValue(new Response("gateway timeout", { status }));
  vi.stubGlobal("fetch", request);
  await expect(generateConfiguredImage({ query } as unknown as Pool, "gpt-image-2", { model: "gpt-image-2", prompt: "test" }))
    .rejects.toMatchObject({ code: "upstream_outcome_unknown" });
  expect(request).toHaveBeenCalledTimes(1);
});

it("restores model health after a successful Base64 image response", async () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update("test-only"), cipher.final()]);
  vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", key.toString("base64"));
  const query = vi.fn().mockResolvedValue({ rows: [{
    id: "first", provider_model_id: "image-model",
    base_url: "https://provider.test/v1", api_format: "openai",
    key_ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64"),
  }] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    data: [{ b64_json: "aW1hZ2U=" }],
  }))));
  const image = await generateConfiguredImage({ query } as unknown as Pool, "gpt-image-2", { model: "gpt-image-2", prompt: "test" });
  expect(image?.url).toBe("data:image/png;base64,aW1hZ2U=");
  expect(query).toHaveBeenCalledWith(expect.stringContaining("last_succeeded_at=now()"), ["image-model"]);
  expect(query).toHaveBeenCalledTimes(3);
});

it("classifies a 2xx non-JSON image response as an invalid provider response", async () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update("test-only"), cipher.final()]);
  vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", key.toString("base64"));
  const query = vi.fn().mockResolvedValue({ rows: [{
    id: "first", provider_model_id: "image-model", base_url: "https://provider.test/v1", api_format: "openai",
    key_ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64"),
  }] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gateway html", { status: 200 })));

  await expect(generateConfiguredImage({ query } as unknown as Pool, "gpt-image-2", { model: "gpt-image-2", prompt: "test" }))
    .rejects.toMatchObject({ code: "invalid_provider_response", message: "provider returned malformed image response" });
  expect(query).not.toHaveBeenCalledWith(expect.stringContaining("failure_count=failure_count+1"), expect.anything());
});

it("reads a custom imageUrlPath response without falling back to generic parsing", async () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update("test-only"), cipher.final()]);
  vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", key.toString("base64"));
  const query = vi.fn().mockResolvedValue({ rows: [{
    id: "custom-provider", provider_model_id: "custom-image", base_url: "https://custom.test", api_format: "custom",
    key_ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64"),
    request_template: { model: "{{model}}", prompt: "{{prompt}}" },
    response_template: { imageUrlPath: "result.image.url" },
  }] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { image: { url: "https://cdn.test/custom.png" } } }), { status: 200 })));

  const image = await generateConfiguredImage({ query } as unknown as Pool, "custom-image", { model: "custom-image", prompt: "test" });

  expect(image).toMatchObject({ url: "https://cdn.test/custom.png", mimeType: "image/png" });
  expect(query).toHaveBeenCalledWith(expect.stringContaining("last_succeeded_at=now()"), ["custom-image"]);
});

it("renders custom image templates with explicit URL and inline input fields", async () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update("test-only"), cipher.final()]);
  vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", key.toString("base64"));
  const query = vi.fn().mockResolvedValue({ rows: [{
    id: "custom-image-inputs",
    provider_model_id: "custom-image-inputs",
    base_url: "https://custom.test",
    api_format: "custom",
    key_ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64"),
    request_template: {
      model: "{{model}}",
      prompt: "{{prompt}}",
      input_images: "{{input_images}}",
      reference_image: "{{reference_image}}",
    },
    response_template: { imageUrlPath: "result.image.url" },
  }] });
  const requests: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ result: { image: { url: "https://cdn.test/custom.png" } } }), { status: 200 });
  }));

  await generateConfiguredImage({ query } as unknown as Pool, "custom-image-inputs", {
    model: "custom-image-inputs",
    prompt: "edit",
    inputImages: ["https://assets.example/frame.png"],
  });
  await generateConfiguredImage({ query } as unknown as Pool, "custom-image-inputs", {
    model: "custom-image-inputs",
    prompt: "edit",
    inputImages: ["data:image/png;base64,cGlj"],
  });

  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({
    input_images: JSON.stringify(["https://assets.example/frame.png"]),
    reference_image: "https://assets.example/frame.png",
  });
  expect(requests[1]).toMatchObject({
    input_images: JSON.stringify(["data:image/png;base64,cGlj"]),
    reference_image: "data:image/png;base64,cGlj",
  });
});

it("reads the standard image URL response shape", async () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update("test-only"), cipher.final()]);
  vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", key.toString("base64"));
  const query = vi.fn().mockResolvedValue({ rows: [{
    id: "openai-provider", provider_model_id: "gpt-image-2", base_url: "https://openai.test/v1", api_format: "openai",
    key_ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64"),
    request_template: {}, response_template: {},
  }] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ url: "https://cdn.test/standard.png" }] }), { status: 200 })));

  await expect(generateConfiguredImage({ query } as unknown as Pool, "gpt-image-2", { model: "gpt-image-2", prompt: "test" }))
    .resolves.toMatchObject({ url: "https://cdn.test/standard.png", mimeType: "image/png" });
});

it("treats an unavailable remote reference asset as request-level input failure", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{
    id: "replicate-provider", provider_model_id: "flux-model", base_url: "https://replicate.test/v1", api_format: "replicate",
    key_ciphertext: "unused", request_template: {}, response_template: {},
  }] });

  await expect(generateConfiguredImage({ query } as unknown as Pool, "black-forest-labs/flux-kontext-pro", {
    model: "black-forest-labs/flux-kontext-pro",
    prompt: "edit",
    inputImages: ["https://assets.test/reference.png"],
  }, { providerUrlForInput: async () => { throw Object.assign(new Error("reference image unavailable"), { code: "invalid_input" }); } }))
    .rejects.toMatchObject({ code: "invalid_input", message: "reference image unavailable" });
  expect(query).not.toHaveBeenCalledWith(expect.stringContaining("failure_count=failure_count+1"), expect.anything());
});
