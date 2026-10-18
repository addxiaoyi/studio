import Fastify from "fastify";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerGenerateRoutes } from "./generate.js";
import { generateImage } from "../generation/image-generation.js";
import { generateConfiguredImage } from "../local-db/provider-generation.js";

vi.mock("../generation/image-generation.js", () => ({ generateImage: vi.fn() }));
vi.mock("../local-db/provider-generation.js", () => ({ generateConfiguredImage: vi.fn() }));
vi.mock("../generation/providers/registry.js", () => ({
  resolveImageProviderName: () => "legacy", getAvailableVideoModels: () => [],
}));

const apps: ReturnType<typeof Fastify>[] = [];
const image = { url: "data:image/png;base64,dGVzdA==", mimeType: "image/png", width: 1024, height: 1024 };
beforeEach(() => {
  vi.mocked(generateConfiguredImage).mockReset().mockResolvedValue(image);
  vi.mocked(generateImage).mockReset().mockResolvedValue(image);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("image-bytes")));
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllGlobals();
});

async function imageApi(configured = true) {
  const app = Fastify();
  apps.push(app);
  const uploadFile = vi.fn().mockResolvedValue({ asset: { id: "asset-id" }, url: "/api/uploads/asset-id/file" });
  await registerGenerateRoutes(app, {
    auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-id", accessToken: "test", userMetadata: {} }) },
    viewerService: { ensureViewer: vi.fn().mockResolvedValue({ workspace: { id: "workspace-id" } }) } as never,
    uploadService: { uploadFile } as never,
    ...(configured ? { localDb: {} as never } : {}),
  });
  await app.ready();
  return { app, uploadFile };
}

it("uses the configured Image 2 provider and persists the returned image", async () => {
  const reference = "data:image/png;base64,dGVzdA==";
  const { app, uploadFile } = await imageApi();
  const reply = await app.inject({ method: "POST", url: "/api/agent/generate-image", payload: { prompt: "One mug", model: "gpt-image-2", inputImages: [reference] } });
  expect(reply.statusCode).toBe(200);
  expect(reply.json()).toMatchObject({ assetId: "asset-id", url: "/api/uploads/asset-id/file" });
  expect(generateConfiguredImage).toHaveBeenCalledWith(expect.anything(), "gpt-image-2", expect.objectContaining({ model: "gpt-image-2", prompt: "One mug", inputImages: [reference] }));
  expect(generateImage).not.toHaveBeenCalled();
  expect(uploadFile).toHaveBeenCalledTimes(1);
}, 20_000);

it("accepts a reference-only request and lets the server provide the texture prompt", async () => {
  const { app } = await imageApi();
  const reply = await app.inject({
    method: "POST",
    url: "/api/agent/generate-image",
    payload: { model: "gpt-image-2", inputImages: ["data:image/png;base64,dGVzdA=="] },
  });
  expect(reply.statusCode).toBe(200);
  expect(generateConfiguredImage).toHaveBeenCalledWith(
    expect.anything(),
    "gpt-image-2",
    expect.objectContaining({ prompt: "", inputImages: ["data:image/png;base64,dGVzdA=="] }),
  );
});

it("does not silently switch to legacy models when no configured channel is callable", async () => {
  vi.mocked(generateConfiguredImage).mockResolvedValue(null);
  const { app, uploadFile } = await imageApi();
  const reply = await app.inject({ method: "POST", url: "/api/agent/generate-image", payload: { prompt: "One mug" } });
  expect(reply.statusCode).toBe(502);
  expect(reply.json().error.message).toContain("没有可调用渠道");
  expect(generateImage).not.toHaveBeenCalled();
  expect(uploadFile).not.toHaveBeenCalled();
});

it("stops a refused request without retrying through the legacy provider", async () => {
  vi.mocked(generateConfiguredImage).mockRejectedValue(Object.assign(new Error("上游拒绝了本次图片请求"), { code: "safety_filter" }));
  const { app } = await imageApi();
  const reply = await app.inject({ method: "POST", url: "/api/agent/generate-image", payload: { prompt: "One mug", model: "gpt-image-2" } });
  expect(reply.statusCode).toBe(502);
  expect(generateConfiguredImage).toHaveBeenCalledTimes(1);
  expect(generateImage).not.toHaveBeenCalled();
});

it("keeps the existing registered provider path outside local database mode", async () => {
  const { app } = await imageApi(false);
  const reply = await app.inject({ method: "POST", url: "/api/agent/generate-image", payload: { prompt: "One mug", model: "legacy-model" } });
  expect(reply.statusCode).toBe(200);
  expect(generateImage).toHaveBeenCalledTimes(1);
  expect(generateConfiguredImage).not.toHaveBeenCalled();
});

it("rejects retired SeedEdit before configured-model lookup, credit deduction, or provider calls", async () => {
  const app = Fastify();
  apps.push(app);
  const query = vi.fn();
  const calculateCreditCost = vi.fn().mockResolvedValue(5);
  const deductCredits = vi.fn();
  await registerGenerateRoutes(app, {
    auth: { authenticate: vi.fn().mockResolvedValue({ id: "user-id", accessToken: "test", userMetadata: {} }) },
    viewerService: { ensureViewer: vi.fn() } as never,
    uploadService: { uploadFile: vi.fn() } as never,
    creditService: { deductCredits } as never,
    tierGuard: { checkModelAccess: vi.fn(), checkResolution: vi.fn(), checkConcurrency: vi.fn(), calculateCreditCost } as never,
    localDb: { query } as never,
  });
  await app.ready();

  const reply = await app.inject({ method: "POST", url: "/api/agent/generate-image", payload: { prompt: "edit image", model: "doubao-seededit-3-0-i2i-250628" } });

  expect(reply.statusCode).toBe(410);
  expect(reply.json().error.code).toBe("model_retired");
  expect(query).not.toHaveBeenCalled();
  expect(calculateCreditCost).not.toHaveBeenCalled();
  expect(deductCredits).not.toHaveBeenCalled();
  expect(generateConfiguredImage).not.toHaveBeenCalled();
  expect(generateImage).not.toHaveBeenCalled();
});
