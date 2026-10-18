import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  calculateCompletedCredits,
  normalizeReferenceImageUrls,
  resolveEcomReferenceImage,
} from "./local-ecom-image.js";

describe("normalizeReferenceImageUrls", () => {
  it("keeps ordered multi-image input and removes duplicates", () => {
    expect(
      normalizeReferenceImageUrls({ referenceImageUrls: ["primary", "detail", "primary"] }),
    ).toEqual(["primary", "detail"]);
  });

  it("keeps the legacy single-image field compatible", () => {
    expect(normalizeReferenceImageUrls({ referenceImageUrl: "legacy" })).toEqual([
      "legacy",
    ]);
  });
});

describe("calculateCompletedCredits", () => {
  it("preserves fractional image prices", () => {
    expect(calculateCompletedCredits(0.1, 1, 1)).toBe(0.1);
    expect(calculateCompletedCredits(0.15, 3, 2)).toBe(0.1);
  });

  it("charges only successful images", () => {
    expect(calculateCompletedCredits(0.3, 3, 1)).toBe(0.1);
    expect(calculateCompletedCredits(0.3, 3, 0)).toBe(0);
  });

  it("does not divide by an empty batch", () => {
    expect(calculateCompletedCredits(0.1, 0, 0)).toBe(0);
  });
});

describe("resolveEcomReferenceImage", () => {
  it("keeps data URLs and absolute URLs unchanged", async () => {
    const db = { query: vi.fn() } as unknown as Pool;
    const dataUrl = "data:image/png;base64,aGVsbG8=";
    await expect(resolveEcomReferenceImage(db, "workspace", dataUrl)).resolves.toBe(
      dataUrl,
    );
    await expect(
      resolveEcomReferenceImage(db, "workspace", "https://cdn.example/image.png"),
    ).resolves.toBe("https://cdn.example/image.png");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("converts a workspace asset into a data URL", async () => {
    const root = await mkdtemp(join(tmpdir(), "helstera-ecom-"));
    const objectPath = "workspace/uploads/reference.png";
    await mkdir(join(root, "project-assets", "workspace", "uploads"), {
      recursive: true,
    });
    await writeFile(join(root, "project-assets", objectPath), Buffer.from("image"));
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            bucket: "project-assets",
            object_path: objectPath,
            mime_type: "image/png",
            byte_size: 5,
          },
        ],
      }),
    } as unknown as Pool;

    await expect(
      resolveEcomReferenceImage(
        db,
        "11111111-1111-1111-1111-111111111111",
        "/api/uploads/22222222-2222-2222-2222-222222222222/file",
        root,
      ),
    ).resolves.toBe("data:image/png;base64,aW1hZ2U=");
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("workspace_id=$2"),
      [
        "22222222-2222-2222-2222-222222222222",
        "11111111-1111-1111-1111-111111111111",
      ],
    );
  });

  it("rejects unknown relative paths and inaccessible assets", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;
    await expect(
      resolveEcomReferenceImage(db, "workspace", "/uploads/reference.png"),
    ).rejects.toThrow("参考图地址无效");
    await expect(
      resolveEcomReferenceImage(
        db,
        "workspace",
        "/api/uploads/22222222-2222-2222-2222-222222222222/file",
      ),
    ).rejects.toThrow("不属于当前工作区");
  });
});
