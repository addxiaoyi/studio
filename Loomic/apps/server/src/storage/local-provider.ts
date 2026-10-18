/**
 * Local Filesystem Storage Provider
 *
 * Stores files in: /www/helstera/uploads/{bucket}/{path}
 * Serves files via: GET /api/storage/{bucket}/{path}
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  StorageProvider,
  UploadOptions,
  StorageFile,
} from "./provider.js";
import { StorageError } from "./provider.js";

export interface LocalStorageConfig {
  /** Base directory for file storage (default: /www/helstera/uploads) */
  baseDir: string;
  /** Base URL for serving files (default: http://localhost:8080/api/storage) */
  baseUrl: string;
}

export class LocalStorageProvider implements StorageProvider {
  private readonly baseDir: string;
  private readonly baseUrl: string;

  constructor(config: LocalStorageConfig) {
    this.baseDir = config.baseDir;
    this.baseUrl = config.baseUrl;
  }

  async upload(
    bucket: string,
    filePath: string,
    file: Buffer | NodeJS.ReadableStream,
    options?: UploadOptions,
  ): Promise<void> {
    const fullPath = this.getFullPath(bucket, filePath);

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      if (Buffer.isBuffer(file)) {
        await fs.writeFile(fullPath, file);
      } else if (file instanceof Readable) {
        const writeStream = (await import("node:fs")).createWriteStream(fullPath);
        await pipeline(file, writeStream);
      } else {
        throw new StorageError(
          "Invalid file type: must be Buffer or ReadableStream",
          "INVALID_FILE_TYPE",
          400,
        );
      }

      // Store metadata if provided
      if (options?.contentType) {
        await this.saveMetadata(fullPath, { contentType: options.contentType, ...(options.cacheControl ? { cacheControl: options.cacheControl } : {}) });
      }
    } catch (error) {
      if (error instanceof StorageError) throw error;

      console.error("[LocalStorage] Upload failed:", error);
      throw new StorageError(
        `Failed to upload file: ${filePath}`,
        "UPLOAD_FAILED",
        500,
      );
    }
  }

  getPublicUrl(bucket: string, filePath: string): string {
    return `${this.baseUrl}/${bucket}/${filePath}`;
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    const errors: string[] = [];

    for (const filePath of paths) {
      try {
        const fullPath = this.getFullPath(bucket, filePath);
        await fs.unlink(fullPath);

        // Also remove metadata file if exists
        const metaPath = `${fullPath}.meta.json`;
        try {
          await fs.unlink(metaPath);
        } catch {
          // Metadata file might not exist, ignore
        }
      } catch (error) {
        console.error(`[LocalStorage] Failed to remove ${filePath}:`, error);
        errors.push(filePath);
      }
    }

    if (errors.length > 0) {
      throw new StorageError(
        `Failed to remove ${errors.length} file(s)`,
        "REMOVE_FAILED",
        500,
      );
    }
  }

  async download(bucket: string, filePath: string): Promise<Buffer> {
    const fullPath = this.getFullPath(bucket, filePath);

    try {
      return await fs.readFile(fullPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StorageError(
          `File not found: ${filePath}`,
          "FILE_NOT_FOUND",
          404,
        );
      }

      console.error("[LocalStorage] Download failed:", error);
      throw new StorageError(
        `Failed to download file: ${filePath}`,
        "DOWNLOAD_FAILED",
        500,
      );
    }
  }

  async list(bucket: string, dirPath = ""): Promise<StorageFile[]> {
    const fullPath = this.getFullPath(bucket, dirPath);

    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const files: StorageFile[] = [];

      for (const entry of entries) {
        if (entry.isFile() && !entry.name.endsWith(".meta.json")) {
          const filePath = path.join(fullPath, entry.name);
          const stats = await fs.stat(filePath);
          const relativePath = path.relative(
            path.join(this.baseDir, bucket),
            filePath,
          );

          files.push({
            name: entry.name,
            path: relativePath.replace(/\\/g, "/"),
            size: stats.size,
            createdAt: stats.birthtime,
            updatedAt: stats.mtime,
          });
        }
      }

      return files;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return []; // Directory doesn't exist, return empty list
      }

      console.error("[LocalStorage] List failed:", error);
      throw new StorageError(
        `Failed to list files in: ${dirPath}`,
        "LIST_FAILED",
        500,
      );
    }
  }

  private getFullPath(bucket: string, filePath: string): string {
    // Normalize path separators and prevent path traversal
    const normalizedPath = filePath.replace(/\\/g, "/").replace(/\.\./g, "");
    return path.join(this.baseDir, bucket, normalizedPath);
  }

  private async saveMetadata(
    filePath: string,
    metadata: { contentType?: string; cacheControl?: string },
  ): Promise<void> {
    const metaPath = `${filePath}.meta.json`;
    try {
      await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.warn("[LocalStorage] Failed to save metadata:", error);
      // Don't throw - metadata is optional
    }
  }
}
