import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { registerLocalGrowthRoutes } from "./local-growth.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const libraryId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const app = Fastify();
  apps.push(app);
  const query = vi
    .fn()
    .mockResolvedValue({
      rows: [
        {
          asset_id: fileId,
          library_asset_id: libraryId,
          mime_type: "image/png",
          title: "试穿结果",
          retention_until: "2030-01-01T00:00:00Z",
        },
      ],
    });
  const authenticate = vi.fn().mockResolvedValue({ id: "owner" });
  registerLocalGrowthRoutes(app, {
    db: { query } as never,
    auth: { authenticate } as never,
    viewerService: {
      ensureViewer: async () => ({ workspace: { id: "workspace" } }),
    } as never,
  });
  return { app, query, authenticate };
}
it("resolves the library identifier to its actual private file without exposing storage paths", async () => {
  const { app, query } = fixture();
  const response = await app.inject(`/api/assets/${libraryId}/canvas-source`);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    ok: true,
    data: {
      assetId: fileId,
      libraryAssetId: libraryId,
      mimeType: "image/png",
      title: "试穿结果",
      retentionUntil: "2030-01-01T00:00:00Z",
    },
  });
  expect(query.mock.calls[0]?.[1]).toEqual([libraryId, "workspace", "owner"]);
});
it("rejects unauthenticated, malformed and inaccessible material requests", async () => {
  const { app, query, authenticate } = fixture();
  authenticate.mockResolvedValueOnce(null);
  expect(
    (await app.inject(`/api/assets/${libraryId}/canvas-source`)).statusCode,
  ).toBe(401);
  expect(
    (await app.inject("/api/assets/not-an-id/canvas-source")).statusCode,
  ).toBe(400);
  query.mockResolvedValueOnce({ rows: [] });
  expect(
    (await app.inject(`/api/assets/${libraryId}/canvas-source`)).statusCode,
  ).toBe(404);
});
