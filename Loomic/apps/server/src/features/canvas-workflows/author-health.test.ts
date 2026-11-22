import { afterEach, expect, it, vi } from "vitest";
import {
  createWorkflowAuthorCheck,
  inspectConfiguredAuthor,
} from "./author-health.js";

const google = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    fetch = google.fetch;
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("blocks a missing key without sending any request", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  expect((await inspectConfiguredAuthor({}, { model: "writer" })).ready).toBe(
    false,
  );
  expect(request).not.toHaveBeenCalled();
});
it("checks only metadata on the exact configured OpenAI-compatible connection", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", request);
  expect(
    (
      await inspectConfiguredAuthor(
        {},
        {
          model: "writer",
          baseUrl: "http://127.0.0.1:4000/v1",
          apiKey: "fixture-key",
        },
      )
    ).ready,
  ).toBe(true);
  expect(String(request.mock.calls[0]?.[0])).toBe(
    "http://127.0.0.1:4000/v1/models",
  );
  expect(request).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({
      method: "GET",
      redirect: "error",
      headers: { Authorization: "Bearer fixture-key" },
    }),
  );
});
it("reports revoked credentials and masks transport details", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 401 }))
    .mockRejectedValueOnce(new Error("internal secret transport"));
  vi.stubGlobal("fetch", request);
  const config = { model: "writer", apiKey: "fixture-key" };
  expect((await inspectConfiguredAuthor({}, config)).message).toContain(
    "认证失败",
  );
  const failed = await inspectConfiguredAuthor({}, config);
  expect(failed.ready).toBe(false);
  expect(failed.message).not.toContain("secret");
});
it("checks Google API model metadata without inference", async () => {
  vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
  vi.stubEnv("GOOGLE_VERTEX_LOCATION", "");
  vi.stubEnv("GOOGLE_API_KEY", "fixture-google-key");
  const request = vi
    .fn()
    .mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", request);
  expect(
    (await inspectConfiguredAuthor({}, { model: "google:gemini-2.5-flash" }))
      .ready,
  ).toBe(true);
  expect(String(request.mock.calls[0]?.[0])).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash",
  );
  expect(request).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({
      method: "GET",
      headers: { "x-goog-api-key": "fixture-google-key" },
    }),
  );
});
it("uses ADC for Vertex metadata and surfaces permission failures", async () => {
  vi.stubEnv("GOOGLE_VERTEX_PROJECT", "fixture-project");
  vi.stubEnv("GOOGLE_VERTEX_LOCATION", "us-central1");
  google.fetch
    .mockResolvedValueOnce({ status: 200 })
    .mockRejectedValueOnce({ response: { status: 403 } });
  const config = { model: "google:gemini-2.5-flash" };
  expect((await inspectConfiguredAuthor({}, config)).ready).toBe(true);
  expect(google.fetch).toHaveBeenCalledWith(
    "https://us-central1-aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash",
    expect.objectContaining({ method: "GET" }),
  );
  expect((await inspectConfiguredAuthor({}, config)).message).toContain(
    "认证失败",
  );
});
it("reads the author configuration for the same user and workspace", async () => {
  const getChatModelConfig = vi
    .fn()
    .mockResolvedValue({ model: "writer", apiKey: "fixture-key" });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
  );
  const check = createWorkflowAuthorCheck(
    {},
    {
      getChatModelConfig,
      getWorkspaceSettings: vi.fn(),
      updateWorkspaceSettings: vi.fn(),
    },
  );
  expect(
    (await check({ userId: "user", workspaceId: "workspace" })).ready,
  ).toBe(true);
  expect(getChatModelConfig).toHaveBeenCalledWith(
    expect.objectContaining({ id: "user" }),
    "workspace",
  );
});
