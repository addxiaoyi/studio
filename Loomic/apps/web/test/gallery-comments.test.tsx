// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import GalleryPage from "@/app/(workspace)/gallery/page";

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "user-1" }, session: null, loading: false, signOut: vi.fn() }),
}));

describe("Gallery comments", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads comments and removes the current user's comment", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: [{
        id: "gallery-1", asset_id: "asset-1", title: "测试作品", description: null, prompt: null,
        media_type: "image", mime_type: "image/png", object_url: "/asset.png", like_count: 0,
        comment_count: 1, published_at: "2026-09-25T00:00:00.000Z",
      }] }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: [{
        id: "comment-1", gallery_id: "gallery-1", user_id: "user-1", body: "很好的配色",
        author_name: "Mia", created_at: "2026-09-25T01:00:00.000Z", can_delete: true,
      }] }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { id: "comment-1" } }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GalleryPage />);

    await screen.findByText("测试作品");
    await userEvent.click(screen.getByRole("button", { name: /1/ }));
    expect(await screen.findByText("Mia")).toBeInTheDocument();
    expect(screen.getByText("很好的配色")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "删除评论" }));
    await waitFor(() => expect(screen.queryByText("很好的配色")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/gallery/comments/comment-1", { method: "DELETE", credentials: "include" });
  });
});
