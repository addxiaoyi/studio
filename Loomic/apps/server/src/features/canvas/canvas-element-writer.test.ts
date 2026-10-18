import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { insertLocalImageElement, insertLocalVideoElement, insertVideoElement } from "./canvas-element-writer.js";

function makeDb(content: Record<string, unknown>) {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes("select content from canvases")) return { rows: [{ content }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const db = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  return { db, client, queries };
}

const storage = {
  download: vi.fn().mockResolvedValue({ data: Buffer.from("asset"), error: null }),
};

describe("local canvas element writer", () => {
  it("does not append a duplicate image for a completed job", async () => {
    const { db, client, queries } = makeDb({
      elements: [{ id: "existing-image", customData: { jobId: "job-1" } }],
    });

    const result = await insertLocalImageElement(db, storage, {
      canvasId: "canvas-1",
      objectPath: "workspace/generated/image.png",
      width: 640,
      height: 480,
      mimeType: "image/png",
      assetId: "asset-1",
      jobId: "job-1",
    });

    expect(result).toEqual({ elementId: "existing-image" });
    expect(queries.some((query) => query.startsWith("update canvases"))).toBe(false);
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("does not append a duplicate video for a completed job", async () => {
    const { db, client, queries } = makeDb({
      elements: [{ id: "existing-video", customData: { jobId: "job-2" } }],
    });

    const result = await insertLocalVideoElement(db, {
      canvasId: "canvas-1",
      signedUrl: "https://example.test/video.mp4",
      width: 1280,
      height: 720,
      mimeType: "video/mp4",
      assetId: "asset-2",
      jobId: "job-2",
    });

    expect(result).toEqual({ elementId: "existing-video" });
    expect(queries.some((query) => query.startsWith("update canvases"))).toBe(false);
    expect(client.query).toHaveBeenCalledWith("commit");
  });
});

describe("Supabase video canvas writer", () => {
  it("writes the stable job marker and signed video URL with an atomic duplicate guard", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const filters: unknown[][] = [];
    const query = {
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "canvas-1" }, error: null }),
      eq: vi.fn().mockReturnThis(),
      filter: vi.fn((...args: unknown[]) => { filters.push(args); return query; }),
      update: vi.fn((value: Record<string, unknown>) => { writes.push(value); return query; }),
      single: vi.fn()
        .mockResolvedValueOnce({ data: { content: { elements: [] } }, error: null })
        .mockResolvedValueOnce({ data: { id: "canvas-1" }, error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(query) };

    const result = await insertVideoElement(client, {
      canvasId: "canvas-1",
      signedUrl: "https://storage.test/signed/video.mp4",
      width: 1280,
      height: 720,
      mimeType: "video/mp4",
      assetId: "asset-1",
      jobId: "job-unique-1",
    });

    const elements = (writes[0]?.content as { elements: Array<Record<string, unknown>> }).elements;
    expect(filters).toContainEqual(["content->elements", "not.cs", '[{"customData":{"jobId":"job-unique-1"}}]']);
    expect(elements[0]).toMatchObject({ link: "https://storage.test/signed/video.mp4", customData: { assetId: "asset-1", jobId: "job-unique-1" } });
    expect(result.elementId).toBeTypeOf("string");
  });

  it("keeps a concurrent retry idempotent against shared Canvas state", async () => {
    let content: { elements: Array<Record<string, unknown>> } = { elements: [] };
    let waitingUpdates = 0;
    let releaseUpdates!: () => void;
    const bothUpdatesReady = new Promise<void>((resolve) => { releaseUpdates = resolve; });
    const operations: string[] = [];

    const client = {
      from: vi.fn(() => {
        let selectedContent: { elements: Array<Record<string, unknown>> } | null = null;
        let candidate: { elements: Array<Record<string, unknown>> } | null = null;
        let guardedJobId: string | null = null;
        const builder: Record<string, any> = {
          select: vi.fn(() => {
            selectedContent = structuredClone(content);
            operations.push("select");
            return builder;
          }),
          eq: vi.fn(() => builder),
          filter: vi.fn((_column: string, _operator: string, containment: string) => {
            guardedJobId = JSON.parse(containment)[0].customData.jobId;
            return builder;
          }),
          update: vi.fn((value: { content: { elements: Array<Record<string, unknown>> } }) => {
            candidate = value.content;
            operations.push("update");
            return builder;
          }),
          maybeSingle: vi.fn(async () => {
            if (!candidate) return { data: selectedContent, error: null };
            waitingUpdates += 1;
            if (waitingUpdates === 2) releaseUpdates();
            await bothUpdatesReady;

            const existing = content.elements.find((item) => (item.customData as { jobId?: string } | undefined)?.jobId === guardedJobId);
            if (existing) return { data: null, error: null };
            content = candidate;
            return { data: { id: "canvas-1" }, error: null };
          }),
          single: vi.fn(async () => ({ data: { content: structuredClone(content) }, error: null })),
        };
        return builder;
      }),
    };
    const input = {
      canvasId: "canvas-1",
      signedUrl: "https://storage.test/signed/video.mp4",
      width: 1280,
      height: 720,
      mimeType: "video/mp4",
      jobId: "job-parallel",
    };

    const results = await Promise.all([
      insertVideoElement(client, input),
      insertVideoElement(client, input),
    ]);

    expect(content.elements.filter((item) => (item.customData as { jobId?: string })?.jobId === input.jobId)).toHaveLength(1);
    expect(results[0]!.elementId).toBe(results[1]!.elementId);
    expect(operations.filter((operation) => operation === "update")).toHaveLength(2);
  });
});
