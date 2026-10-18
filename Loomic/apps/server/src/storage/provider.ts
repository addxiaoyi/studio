/**
 * Storage Provider Abstraction Layer
 *
 * Unified interface for file storage operations.
 * Supports both local filesystem storage and local filesystem.
 */

export interface StorageProvider {
  /**
   * Upload a file to storage
   * @param bucket - Storage bucket name
   * @param path - File path within the bucket
   * @param file - File buffer or readable stream
   * @param options - Additional upload options
   */
  upload(
    bucket: string,
    path: string,
    file: Buffer | NodeJS.ReadableStream,
    options?: UploadOptions,
  ): Promise<void>;

  /**
   * Get public URL for a file
   * @param bucket - Storage bucket name
   * @param path - File path within the bucket
   */
  getPublicUrl(bucket: string, path: string): string;

  /**
   * Remove files from storage
   * @param bucket - Storage bucket name
   * @param paths - Array of file paths to remove
   */
  remove(bucket: string, paths: string[]): Promise<void>;

  /**
   * Download a file from storage
   * @param bucket - Storage bucket name
   * @param path - File path within the bucket
   */
  download(bucket: string, path: string): Promise<Buffer>;

  /**
   * List files in a bucket path
   * @param bucket - Storage bucket name
   * @param path - Directory path (optional)
   */
  list(bucket: string, path?: string): Promise<StorageFile[]>;
}

export interface UploadOptions {
  contentType?: string;
  cacheControl?: string;
  upsert?: boolean;
}

export interface StorageFile {
  name: string;
  path: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
