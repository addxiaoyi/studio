import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { createProviderAssetUrl } from "../features/uploads/provider-asset-url.js";
import { registerLocalAssetRoutes } from "./local-assets.js";

it.each(["download", "provider", "thumbnail"])(
  "rejects a %s whose path resolves outside the storage root",
  async (route) => {
    const folder = await mkdtemp(join(tmpdir(), "helstera-path-boundary-"));
    const root = join(folder, "storage");
    const outside = join(folder, "outside");
    const link = join(root, "project-assets", "workspace-1");
    const objectPath = "workspace-1/image.webp";
    const secret = "asset-path-fixture";
    const app = Fastify();
    vi.stubEnv("PROVIDER_CONFIG_ENCRYPTION_KEY", secret);
    try {
      await mkdir(join(root, "project-assets"), { recursive: true });
      await mkdir(outside);
      await writeFile(join(outside, "image.webp"), "outside-storage-secret");
      await symlink(
        outside,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
      registerLocalAssetRoutes(app, {
        root,
        auth: { authenticate: async () => ({ id: "owner" }) } as never,
        db: {
          query: vi.fn().mockResolvedValue({
            rows: [
              {
                workspace_id: "workspace-1",
                thumbnail_path: objectPath,
                bucket: "project-assets",
                object_path: objectPath,
                mime_type: "image/webp",
              },
            ],
          }),
        } as never,
      });
      const signed = new URL(
        createProviderAssetUrl({
          origin: "https://studio.example",
          assetId: "object-1",
          secret,
        }),
      );
      const url =
        route === "provider"
          ? signed.pathname + signed.search
          : route === "thumbnail"
            ? "/api/projects/project-1/thumbnail"
            : "/api/uploads/object-1/file";
      const response = await app.inject(url);
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("outside-storage-secret");
    } finally {
      await app.close();
      vi.unstubAllEnvs();
      await unlink(link).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await rm(folder, { recursive: true, force: true });
    }
  },
);
