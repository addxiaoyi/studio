import { afterEach, expect, it, vi } from "vitest";
import { ProviderHttpError, requestProviderJson } from "./provider-http.js";

afterEach(() => vi.unstubAllGlobals());

it("parses JSON success responses", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ task_id: "task-1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(requestProviderJson("https://provider.test", {}, { timeoutMs: 1000, operation: "video", requestId: "req-1" })).resolves.toEqual({ task_id: "task-1" });
  const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  expect(requestInit).toBeDefined();
  expect(new Headers(requestInit?.headers).get("x-helstera-request-id")).toBe("req-1");
});

it("preserves non-JSON error bodies and status", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gateway timeout", { status: 504 })));
  await expect(requestProviderJson("https://provider.test", {}, { timeoutMs: 1000, operation: "video" })).rejects.toMatchObject({ status: 504, name: "ProviderHttpError" } satisfies Partial<ProviderHttpError>);
});

it.each([429, 401, 402, 404, 502, 504])( "preserves HTTP %s", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "upstream" }), { status })));
  await expect(requestProviderJson("https://provider.test", {}, { timeoutMs: 1000, operation: "image" })).rejects.toMatchObject({ status });
});

it("marks a timed-out video submit as an unknown upstream outcome", async () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));

  await expect(requestProviderJson("https://provider.test", {}, {
    timeoutMs: 1000,
    operation: "video",
    phase: "submit",
    requestId: "req-video-1",
  })).rejects.toMatchObject({
    code: "upstream_submit_timeout",
    message: expect.stringContaining("req-video-1"),
  });
});
