type Preview = {
  contentType: string;
  bytes: Buffer;
  size: number;
};

type PreviewPayload = Pick<Preview, "contentType" | "bytes">;

const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

export class MediaPreviewCache {
  private readonly entries = new Map<string, Preview>();
  private readonly pending = new Map<string, Promise<PreviewPayload | null>>();
  private readonly waiters: Array<() => void> = [];
  private totalBytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly maxConcurrentCreates: number;
  private activeCreates = 0;

  constructor(
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxBytes = DEFAULT_MAX_BYTES,
    maxConcurrentCreates = 2,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1)
      throw new Error("Preview cache entry limit must be positive.");
    if (!Number.isInteger(maxBytes) || maxBytes < 1)
      throw new Error("Preview cache byte limit must be positive.");
    if (!Number.isInteger(maxConcurrentCreates) || maxConcurrentCreates < 1)
      throw new Error("Preview creation concurrency must be positive.");
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.maxConcurrentCreates = maxConcurrentCreates;
  }

  get(key: string): PreviewPayload | null {
    const preview = this.entries.get(key);
    if (!preview) return null;
    this.entries.delete(key);
    this.entries.set(key, preview);
    return preview;
  }

  async getOrCreate(
    key: string,
    create: () => Promise<PreviewPayload | null>,
  ): Promise<PreviewPayload | null> {
    const cached = this.get(key);
    if (cached) return cached;

    const running = this.pending.get(key);
    if (running) return running;

    const task = Promise.resolve()
      .then(async () => {
        await this.acquireCreateSlot();
        try {
          const ready = this.get(key);
          if (ready) return ready;
          const preview = await create();
          if (preview) this.set(key, preview.contentType, preview.bytes);
          return preview;
        } finally {
          this.releaseCreateSlot();
        }
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, task);
    return task;
  }

  private acquireCreateSlot(): Promise<void> {
    if (this.activeCreates < this.maxConcurrentCreates) {
      this.activeCreates += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private releaseCreateSlot() {
    this.activeCreates -= 1;
    const next = this.waiters.shift();
    if (next) {
      this.activeCreates += 1;
      next();
    }
  }

  set(key: string, contentType: string, bytes: Buffer): void {
    if (!bytes.length || bytes.length > this.maxBytes) return;

    const previous = this.entries.get(key);
    if (previous) this.totalBytes -= previous.size;
    this.entries.delete(key);
    this.entries.set(key, { contentType, bytes, size: bytes.length });
    this.totalBytes += bytes.length;
    this.evict();
  }

  private evict() {
    while (
      this.entries.size > this.maxEntries ||
      this.totalBytes > this.maxBytes
    ) {
      const oldest = this.entries.entries().next().value as
        | [string, Preview]
        | undefined;
      if (!oldest) return;
      this.entries.delete(oldest[0]);
      this.totalBytes -= oldest[1].size;
    }
  }
}
