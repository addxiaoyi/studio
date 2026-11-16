import { describe, expect, it } from "vitest";
import { MediaPreviewCache } from "./media-preview-cache.js";

describe("MediaPreviewCache", () => {
  it("evicts least recently used previews by entry count", () => {
    const cache = new MediaPreviewCache(2, 100);
    cache.set("a", "image/webp", Buffer.from("a"));
    cache.set("b", "image/webp", Buffer.from("b"));
    expect(cache.get("a")?.bytes.toString()).toBe("a");
    cache.set("c", "image/webp", Buffer.from("c"));

    expect(cache.get("a")?.bytes.toString()).toBe("a");
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")?.bytes.toString()).toBe("c");
  });

  it("does not retain a preview larger than the byte budget", () => {
    const cache = new MediaPreviewCache(2, 3);
    cache.set("large", "image/jpeg", Buffer.from("1234"));

    expect(cache.get("large")).toBeNull();
  });

  it("shares one preview build across concurrent requests", async () => {
    const cache = new MediaPreviewCache();
    let builds = 0;
    const create = async () => {
      builds += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { contentType: "image/jpeg", bytes: Buffer.from("preview") };
    };

    const [first, second] = await Promise.all([
      cache.getOrCreate("same", create),
      cache.getOrCreate("same", create),
    ]);

    expect(builds).toBe(1);
    expect(first?.bytes.toString()).toBe("preview");
    expect(second?.bytes.toString()).toBe("preview");
  });

  it("limits preview builds across different assets", async () => {
    const cache = new MediaPreviewCache(8, 100, 1);
    let active = 0;
    let peak = 0;
    const create = async (value: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { contentType: "image/jpeg", bytes: Buffer.from(value) };
    };

    await Promise.all([
      cache.getOrCreate("one", () => create("one")),
      cache.getOrCreate("two", () => create("two")),
      cache.getOrCreate("three", () => create("three")),
    ]);

    expect(peak).toBe(1);
  });
});
