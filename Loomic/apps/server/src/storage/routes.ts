/**
 * Storage route handler for local mode
 *
 * Serves files from local storage: GET /api/storage/{bucket}/{path}
 */

import type { FastifyInstance } from "fastify";
import type { StorageProvider } from "./provider.js";

export async function registerStorageRoutes(
  app: FastifyInstance,
  storage: StorageProvider,
) {
  // Serve files from storage
  app.get("/api/storage/:bucket/*", async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const filePath = (request.params as { "*": string })["*"];

    if (!filePath) {
      return reply.code(400).send({ error: "File path is required" });
    }

    try {
      const buffer = await storage.download(bucket, filePath);

      // Try to load metadata for content-type
      let contentType = "application/octet-stream";
      try {
        // Infer from extension as fallback
        const ext = filePath.split(".").pop()?.toLowerCase();
        if (ext) {
          const mimeTypes: Record<string, string> = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            webp: "image/webp",
            svg: "image/svg+xml",
            mp4: "video/mp4",
            webm: "video/webm",
            pdf: "application/pdf",
            json: "application/json",
            txt: "text/plain",
            html: "text/html",
            css: "text/css",
            js: "application/javascript",
          };
          contentType = mimeTypes[ext] || contentType;
        }
      } catch {
        // Use default content type
      }

      return reply
        .header("Content-Type", contentType)
        .header("Cache-Control", "public, max-age=31536000")
        .send(buffer);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return reply.code(404).send({ error: "File not found" });
      }

      console.error("[Storage] Download failed:", error);
      return reply.code(500).send({ error: "Failed to download file" });
    }
  });

  // List files in a bucket (for admin/debugging)
  app.get("/api/storage/:bucket", async (request, reply) => {
    const { bucket } = request.params as { bucket: string };
    const { path } = request.query as { path?: string };

    try {
      const files = await storage.list(bucket, path);
      return reply.send({ files });
    } catch (error) {
      console.error("[Storage] List failed:", error);
      return reply.code(500).send({ error: "Failed to list files" });
    }
  });
}
