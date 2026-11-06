import { afterEach, expect, it, vi } from "vitest";
import { oneTakeApi } from "../src/lib/onetake-api";

afterEach(() => vi.unstubAllGlobals());
it("sends bodyless actions without an empty JSON content type", async () => {
  const send = vi.fn(async () => new Response(JSON.stringify({ ok: true, assetId: "saved" }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", send);
  await oneTakeApi.cancel("token", "task");
  await oneTakeApi.cancelExport("token", "export");
  await oneTakeApi.saveAsset("token", "export");
  for (const args of send.mock.calls as unknown as [string, RequestInit][]) {
    expect(new Headers(args[1].headers).has("content-type")).toBe(false);
    expect(args[1].body).toBeUndefined();
  }
});
