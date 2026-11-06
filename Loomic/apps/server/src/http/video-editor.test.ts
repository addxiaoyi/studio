import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerVideoEditorRoutes } from "./video-editor.js";

const user = { id: "user-1", email: "user@example.com", accessToken: "token", userMetadata: {} };
const viewer = { workspace: { id: "workspace-1" } };
const env = { openAIApiBase: "https://api.example.test", openAIApiKey: "test-key", webOrigin: "http://localhost:3204" };

function createApp(modelText: string) {
  const app = Fastify();
  registerVideoEditorRoutes(app, {
    auth: { authenticate: vi.fn().mockResolvedValue(user) },
    env: env as never,
    viewerService: { ensureViewer: vi.fn().mockResolvedValue(viewer) } as never,
    settingsService: { getChatModelConfig: vi.fn().mockResolvedValue({ model: "openai:test", baseUrl: env.openAIApiBase, apiKey: "test-key" }) } as never,
    createPlanModel: () => ({ invoke: vi.fn().mockResolvedValue({ content: modelText }) }) as never,
  });
  return app;
}

const request = { prompt: "剪成竖屏并加字幕", projectId: "MyComp", media: [{ name: "clip.mp4", mimeType: "video/mp4", duration: 10 }] };

describe("video editor planning route", () => {
  it.each([
    { type: "cut", format: "landscape", clips: [{ name: "clip.mp4", duration: 100, start: 0, end: 50 }] },
    { type: "audio", assetName: "clip.mp4", startMs: 0, volume: 1 },
    { type: "caption", text: "caption", startMs: 0, endMs: 999999 },
    { type: "export", format: "mp4", command: "unexpected" },
  ])("rejects invalid model action %j", async (action) => {
    const app = createApp(JSON.stringify({ summary: "unsafe", actions: [action] }));
    const response = await app.inject({ method: "POST", url: "/api/video/editor/plan", payload: request });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it("rejects using an audio file as a video clip", async () => {
    const app = createApp(JSON.stringify({ summary: "wrong type", actions: [{ type: "cut", format: "portrait", clips: [{ name: "music.wav", duration: 10, start: 0, end: 5 }] }] }));
    const response = await app.inject({ method: "POST", url: "/api/video/editor/plan", payload: { ...request, media: [{ name: "music.wav", mimeType: "audio/wav", duration: 10 }] } });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });
  it("returns a validated structured model plan", async () => {
    const app = createApp(JSON.stringify({ summary: "竖屏剪辑", actions: [{ type: "cut", format: "portrait", clips: [{ name: "clip.mp4", duration: 10, start: 0, end: 5 }] }, { type: "caption", text: "标题", startMs: 0, endMs: 1000 }] }));
    const response = await app.inject({ method: "POST", url: "/api/video/editor/plan", payload: request });
    expect(response.statusCode).toBe(200);
    expect(response.json().source).toBe("model");
  });

  it("rejects a model plan that references an asset outside the current project", async () => {
    const app = createApp(JSON.stringify({ summary: "越权", actions: [{ type: "cut", format: "landscape", clips: [{ name: "secret.mp4", duration: 10, start: 0, end: 5 }] }] }));
    const response = await app.inject({ method: "POST", url: "/api/video/editor/plan", payload: request });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("video_plan_unavailable");
  });
});
