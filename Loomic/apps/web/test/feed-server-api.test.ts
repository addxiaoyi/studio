import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFeedRenderStatus, renderFeedPackage, saveFeedStructureDraft, syncFeedTrends } from "../src/lib/server-api";

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("feed server API", () => {
  it("preserves partial trend-sync failures for the UI", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { sources: [{ id: "source-1", count: 4, error: "timeout" }], failed: 1 },
        error: { code: "partial_sync", message: "1 个热点来源同步失败" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncFeedTrends("token")).resolves.toEqual({
      sources: [{ id: "source-1", count: 4, error: "timeout" }],
      failed: 1,
      partial: true,
      message: "1 个热点来源同步失败",
    });
  });

  it("posts a render request to the feed package endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "package-1", status: "rendering", jobs: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderFeedPackage("token", "package-1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/feed/packages/package-1/render"),
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: {
          Authorization: "Bearer token",
          "content-type": "application/json",
        },
      }),
    );
  });

  it("saves a structure draft without using the approval endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "package-1", status: "structured" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveFeedStructureDraft("token", "package-1", { title: "draft" } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/feed/packages/package-1/draft"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("reads render job status for polling", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { packageId: "package-1", status: "rendering", jobs: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFeedRenderStatus("token", "package-1")).resolves.toEqual({
      packageId: "package-1",
      status: "rendering",
      jobs: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/feed/packages/package-1/render-status"),
      expect.anything(),
    );
  });
});
