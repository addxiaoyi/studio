/**
 * Storage provider abstraction — supports both local filesystem storage and local filesystem.
 *
 * Enables complete independence from cloud database by providing a unified interface
 * for file upload, download, signed URLs, and file removal.
 */

export interface StorageProvider {
  /**
   * Upload a file to the specified bucket and path.
   */
  upload(
    bucket: string,
    path: string,
    data: Buffer | Blob,
    options?: {
      contentType?: string;
      cacheControl?: string;
      upsert?: boolean;
    }
  ): Promise<{ error: Error | null }>;

  /**
   * Download a file from the specified bucket and path.
   */
  download(
    bucket: string,
    path: string
  ): Promise<{ data: Buffer | null; error: Error | null }>;

  /**
   * Get a public URL for a file. For local storage, returns a URL served by the app.
   * Returns a URL served by the local app.
   */
  getPublicUrl(
    bucket: string,
    path: string,
    expiresIn?: number
  ): Promise<{ data: { signedUrl: string } | null; error: Error | null }>;

  /**
   * Get multiple signed URLs in batch.
   */
  createSignedUrls(
    bucket: string,
    paths: string[],
    expiresIn: number
  ): Promise<{ data: Array<{ path: string; signedUrl: string }> | null; error: Error | null }>;

  /**
   * Remove one or more files from storage.
   */
  remove(
    bucket: string,
    paths: string[]
  ): Promise<{ error: Error | null }>;

  /**
   * Copy a file within the same bucket.
   */
  copy(
    bucket: string,
    fromPath: string,
    toPath: string
  ): Promise<{ error: Error | null }>;
}
