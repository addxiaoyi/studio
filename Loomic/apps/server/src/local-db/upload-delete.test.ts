import { afterEach, expect, it, vi } from "vitest";
import { createLocalUploadService } from "./upload-service.js";
const disk = vi.hoisted(() => ({ unlink: vi.fn() }));
vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<typeof import("node:fs/promises")>(), unlink: disk.unlink }));
afterEach(() => vi.resetAllMocks());
it("retains metadata when the disk refuses deletion", async () => {
  disk.unlink.mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" }));
  const query = vi.fn(async () => ({ rows: [{ id: "asset", bucket: "private-video", object_path: "video.mp4" }] }));
  const service = createLocalUploadService({ query } as never, "D:/isolated-assets");
  await expect(service.deleteAsset({ id: "owner" } as never, "asset")).rejects.toThrow("permission denied");
  expect(query).toHaveBeenCalledTimes(1);
});
it("completes metadata removal when the file is already absent", async () => {
  disk.unlink.mockRejectedValue(Object.assign(new Error("absent"), { code: "ENOENT" }));
  const query = vi.fn(async () => ({ rows: [{ id: "asset", bucket: "private-video", object_path: "video.mp4" }] }));
  await createLocalUploadService({ query } as never, "D:/isolated-assets").deleteAsset({ id: "owner" } as never, "asset");
  expect(query.mock.calls).toHaveLength(2);
});
