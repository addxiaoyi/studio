import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import type { StorageProvider } from "./storage-provider.js";

/**
 * Local filesystem storage provider.
 *
 * Stores files in a configurable root directory (default: /www/helstera/uploads).
 * Structure: {rootDir}/{bucket}/{path}
 *
 * Public URLs are served by the app via GET /api/storage/:bucket/:path
 */
export function createLocalStorageProvider(options?: {
  rootDir?: string;
  publicUrlBase?: string;
}): StorageProvider {
  const rootDir = options?.rootDir ?? "/www/helstera/uploads";
  const publicUrlBase = options?.publicUrlBase ?? "/api/storage";

  async function ensureDir(dirPath: string): Promise<void> {
    if (!existsSync(dirPath)) {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  function getFullPath(bucket: string, filePath: string): string {
    return path.join(rootDir, bucket, filePath);
  }

  return {
    async upload(bucket, filePath, data, options) {
      try {
        const fullPath = getFullPath(bucket, filePath);
        const dir = path.dirname(fullPath);
        await ensureDir(dir);

        // Check if file exists and upsert is disabled
        if (!options?.upsert && existsSync(fullPath)) {
          return { error: new Error(`File already exists: ${filePath}`) };
        }

        // Convert Blob to Buffer if needed
        let buffer: Buffer;
        buffer = Buffer.isBuffer(data) ? data : Buffer.from(await data.arrayBuffer());

        await fs.writeFile(fullPath, buffer);
        return { error: null };
      } catch (err) {
        return { error: err as Error };
      }
    },

    async download(bucket, filePath) {
      try {
        const fullPath = getFullPath(bucket, filePath);

        if (!existsSync(fullPath)) {
          return { data: null, error: new Error(`File not found: ${filePath}`) };
        }

        const buffer = await fs.readFile(fullPath);
        return { data: buffer, error: null };
      } catch (err) {
        return { data: null, error: err as Error };
      }
    },

    async getPublicUrl(bucket, filePath, expiresIn) {
      try {
        const fullPath = getFullPath(bucket, filePath);

        if (!existsSync(fullPath)) {
          return { data: null, error: new Error(`File not found: ${filePath}`) };
        }

        // Local storage URLs don't expire — return app-relative URL
        // The file service route will serve the actual file
        const signedUrl = `${publicUrlBase}/${bucket}/${filePath}`;
        return { data: { signedUrl }, error: null };
      } catch (err) {
        return { data: null, error: err as Error };
      }
    },

    async createSignedUrls(bucket, paths, expiresIn) {
      try {
        const results = [];
        for (const filePath of paths) {
          const fullPath = getFullPath(bucket, filePath);
          if (existsSync(fullPath)) {
            const signedUrl = `${publicUrlBase}/${bucket}/${filePath}`;
            results.push({ path: filePath, signedUrl });
          }
        }
        return { data: results, error: null };
      } catch (err) {
        return { data: null, error: err as Error };
      }
    },

    async remove(bucket, paths) {
      try {
        for (const filePath of paths) {
          const fullPath = getFullPath(bucket, filePath);
          if (existsSync(fullPath)) {
            await fs.unlink(fullPath);
          }
        }
        return { error: null };
      } catch (err) {
        return { error: err as Error };
      }
    },

    async copy(bucket, fromPath, toPath) {
      try {
        const srcPath = getFullPath(bucket, fromPath);
        const destPath = getFullPath(bucket, toPath);

        if (!existsSync(srcPath)) {
          return { error: new Error(`Source file not found: ${fromPath}`) };
        }

        const destDir = path.dirname(destPath);
        await ensureDir(destDir);

        await fs.copyFile(srcPath, destPath);
        return { error: null };
      } catch (err) {
        return { error: err as Error };
      }
    },
  };
}
