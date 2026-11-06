import { afterEach, expect, it, vi } from "vitest";
import { fetchGeneratedAssets } from "@/lib/server-api";

afterEach(() => vi.unstubAllGlobals());
it("keeps record and file identities separate in the library response", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const assetObjectId = "123e4567-e89b-42d3-a456-426614174001";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id, asset_object_id: assetObjectId, mime_type: "video/mp4", created_at: "2026-11-06" }] }), { headers: { "content-type": "application/json" } })));
  const library = await fetchGeneratedAssets("test");
  expect(library.assets[0]).toMatchObject({ id, assetObjectId, url: expect.stringContaining(`/api/uploads/${assetObjectId}/file`) });
});
