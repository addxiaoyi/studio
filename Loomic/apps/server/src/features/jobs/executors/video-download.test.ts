import { describe, expect, it } from "vitest";
import { decodeVideoDataUri, readVideoBody, resolveVideoMimeType } from "./video-download.js";

describe("video download validation", () => {
  it("decodes non-empty base64 video data only when MIME metadata matches", () => {
    expect(decodeVideoDataUri("data:video/mp4;base64,AQID", "video/mp4")).toEqual(Buffer.from([1, 2, 3]));
    expect(() => decodeVideoDataUri("data:video/webm;base64,AQID", "video/mp4")).toThrow(/MIME type/);
  });

  it.each([
    "data:video/mp4,AQID",
    "data:video/mp4;base64,",
    "data:video/mp4;base64,%%%",
    "data:video/mp4;base64,AQID!",
  ])("rejects malformed or empty data URI %s", (uri) => {
    expect(() => decodeVideoDataUri(uri, "video/mp4")).toThrow();
  });

  it("reads a non-empty HTTP body and rejects empty bodies", async () => {
    await expect(readVideoBody(new Response(new Uint8Array([4, 5]), { status: 200 }))).resolves.toEqual(Buffer.from([4, 5]));
    await expect(readVideoBody(new Response(null, { status: 200 }))).rejects.toThrow(/empty body/);
  });

  it("rejects an oversized declared response before consuming it", async () => {
    const response = new Response(new Uint8Array([1]), { status: 200, headers: { "content-length": String(251 * 1024 * 1024) } });
    await expect(readVideoBody(response)).rejects.toThrow(/250MB limit/);
  });

  it("rejects a stream that errors after partial bytes", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.error(new Error("connection reset"));
      },
    });
    await expect(readVideoBody(new Response(body))).rejects.toThrow(/stream failed: connection reset/);
  });

  it("enforces the streaming byte limit even without a content-length header", async () => {
    const oversizedChunk = new Uint8Array(251 * 1024 * 1024);
    let canceled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(oversizedChunk); },
      cancel() { canceled = true; },
    }));
    await expect(readVideoBody(response)).rejects.toThrow(/250MB limit/);
    expect(canceled).toBe(true);
  });

  it("keeps persisted MIME type aligned with provider and download metadata", () => {
    expect(resolveVideoMimeType("video/webm", "video/webm; codecs=vp9")).toBe("video/webm");
    expect(resolveVideoMimeType(undefined, "video/webm")).toBe("video/webm");
    expect(resolveVideoMimeType("application/octet-stream", null)).toBe("video/mp4");
    expect(() => resolveVideoMimeType("video/mp4", "video/webm")).toThrow(/MIME type does not match/);
    expect(() => resolveVideoMimeType("image/png", null)).not.toThrow();
  });
});
