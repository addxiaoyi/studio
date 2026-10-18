import { mkdir, writeFile, readFile, unlink, copyFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { StorageProvider } from "./storage-provider.js";

/**
 * Local filesystem implementation of StorageProvider
 * Stores files in a directory structure: {root}/{bucket}/{path}
 */
export class LocalStorageProvider implements StorageProvider {
  constructor(
    private readonly root: string,
    private readonly baseUrl: string = "http://localhost:3000/api/storage"
  ) {}

  async upload(
    bucket: string,
    path: string,
    buffer: Buffer,
    options?: { contentType?: string; upsert?: boolean }
  ): Promise<{ error: Error | null }> {
    try {
      const fullPath = join(this.root, bucket, path);

      // Check if file exists
      if (options?.upsert === false) {
        try {
          await access(fullPath);
          return { error: new Error(`File already exists: ${path}`) };
        } catch {
          // File doesn't exist, proceed
        }
      }

      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, buffer);

      console.info(`[storage:local] Uploaded ${bucket}/${path} (${buffer.length} bytes)`);
      return { error: null };
    } catch (err) {
      return { error: new Error(`Local storage upload failed: ${(err as Error).message}`) };
    }
  }

  async getPublicUrl(
    bucket: string,
    path: string,
    expiresIn?: number
  ): Promise<{ data: { signedUrl: string } | null; error: Error | null }> {
    // For local storage, we return a URL to our file serving endpoint
    // In production with local mode, this should be a properly secured endpoint
    const url = `${this.baseUrl}/${bucket}/${path}`;

    // If expiresIn is specified, append it as a query param for future validation
    const signedUrl = expiresIn ? `${url}?expires=${Date.now() + expiresIn * 1000}` : url;

    return { data: { signedUrl }, error: null };
  }

  async createSignedUrls(
    bucket: string,
    paths: string[],
    expiresIn: number
  ): Promise<{ data: Array<{ path: string; signedUrl: string }> | null; error: Error | null }> {
    const expiryTimestamp = Date.now() + expiresIn * 1000;

    const data = paths.map(path => ({
      path,
      signedUrl: `${this.baseUrl}/${bucket}/${path}?expires=${expiryTimestamp}`
    }));

    return { data, error: null };
  }

  async copy(
    bucket: string,
    fromPath: string,
    toPath: string
  ): Promise<{ error: Error | null }> {
    try {
      const sourcePath = join(this.root, bucket, fromPath);
      const destPath = join(this.root, bucket, toPath);

      await mkdir(dirname(destPath), { recursive: true });
      await copyFile(sourcePath, destPath);

      console.info(`[storage:local] Copied ${bucket}/${fromPath} to ${toPath}`);
      return { error: null };
    } catch (err) {
      return { error: new Error(`Local storage copy failed: ${(err as Error).message}`) };
    }
  }

  async remove(bucket: string, paths: string[]): Promise<{ error: Error | null }> {
    try {
      await Promise.all(
        paths.map(async (path) => {
          try {
            const fullPath = join(this.root, bucket, path);
            await unlink(fullPath);
          } catch (err) {
            console.warn(`[storage:local] Failed to remove ${bucket}/${path}:`, err);
          }
        })
      );

      console.info(`[storage:local] Removed ${paths.length} files from ${bucket}`);
      return { error: null };
    } catch (err) {
      return { error: new Error(`Local storage remove failed: ${(err as Error).message}`) };
    }
  }

  async exists(bucket: string, path: string): Promise<boolean> {
    try {
      const fullPath = join(this.root, bucket, path);
      await access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async download(
    bucket: string,
    path: string
  ): Promise<{ data: Buffer | null; error: Error | null }> {
    try {
      const fullPath = join(this.root, bucket, path);
      const buffer = await readFile(fullPath);
      return { data: buffer, error: null };
    } catch (err) {
      return { data: null, error: new Error(`Local storage download failed: ${(err as Error).message}`) };
    }
  }
}
