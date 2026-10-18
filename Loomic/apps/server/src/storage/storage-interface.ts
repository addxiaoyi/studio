/**
 * Storage provider interface - abstracts local filesystem storage and local filesystem
 */
export interface StorageProvider {
  /**
   * Upload a file to storage
   * @param bucket - Storage bucket name
   * @param path - Object path within the bucket
   * @param buffer - File content
   * @param contentType - MIME type
   */
  upload(bucket: string, path: string, buffer: Buffer, contentType?: string): Promise<void>;

  /**
   * Get public URL for a stored object
   * @param bucket - Storage bucket name
   * @param path - Object path within the bucket
   */
  getPublicUrl(bucket: string, path: string): string;

  /**
   * Remove one or more objects from storage
   * @param bucket - Storage bucket name
   * @param paths - Array of object paths to remove
   */
  remove(bucket: string, paths: string[]): Promise<void>;

  /**
   * Check if an object exists
   * @param bucket - Storage bucket name
   * @param path - Object path within the bucket
   */
  exists(bucket: string, path: string): Promise<boolean>;

  /**
   * List objects in a bucket with optional prefix
   * @param bucket - Storage bucket name
   * @param prefix - Optional path prefix
   */
  list(bucket: string, prefix?: string): Promise<string[]>;
}
