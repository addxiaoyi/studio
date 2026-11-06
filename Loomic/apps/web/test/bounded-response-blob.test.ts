import { describe, expect, it, vi } from "vitest";
import { boundedResponseBlob } from "@/lib/bounded-response-blob";

describe("boundedResponseBlob", () => {
  it("reads a video stream within the limit", async () => {
    const response = new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/webm" } });
    const blob = await boundedResponseBlob(response, 3);
    expect(blob.size).toBe(3);
    expect(blob.type).toBe("video/webm");
  });

  it("rejects an oversized declared length", async () => {
    const response = new Response(null, { headers: { "content-length": "4" } });
    await expect(boundedResponseBlob(response, 3)).rejects.toThrow();
  });

  it("cancels a stream that exceeds the limit without a declared length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(4)); },
      cancel,
    });
    await expect(boundedResponseBlob(new Response(stream), 3)).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
