import "@testing-library/jest-dom/vitest";
import GalleryPage from "@/app/(workspace)/gallery/page";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ id: "user-1" }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: account.id } }),
}));

function item(id: string) {
  return {
    id,
    asset_id: `asset-${id}`,
    title: `作品${id}`,
    media_type: "image",
    object_url: `/api/gallery/${id}/media`,
    like_count: 0,
    comment_count: 0,
    published_at: "invalid-date",
  };
}
function reply(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      ok: status === 200,
      data,
      ...(status === 200 ? {} : { error: { message: "暂不可用" } }),
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  account.id = "user-1";
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("offers retry on a failed list without showing a false empty gallery", async () => {
  fetchMock
    .mockResolvedValueOnce(reply([], 503))
    .mockResolvedValueOnce(reply([item("a")]));
  render(<GalleryPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("暂不可用");
  expect(screen.queryByText("还没有公开作品")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新加载作品" }));
  expect(
    await screen.findByRole("heading", { name: "作品a" }),
  ).toBeInTheDocument();
});

it("keeps each card locked independently while another card's request completes", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  fetchMock.mockImplementation(async (url) => {
    if (String(url) === "/api/gallery?limit=60")
      return reply([item("a"), item("b")]);
    return String(url).includes("/a/") ? first.promise : second.promise;
  });
  render(<GalleryPage />);
  const a = await screen.findByRole("button", { name: "点赞 作品a" });
  const b = screen.getByRole("button", { name: "点赞 作品b" });
  fireEvent.click(a);
  fireEvent.click(a);
  fireEvent.click(b);
  expect(a).toBeDisabled();
  expect(b).toBeDisabled();
  await act(async () => {
    second.resolve(reply({ liked: true, likeCount: 1 }));
  });
  expect(a).toBeDisabled();
  expect(b).toBeEnabled();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  await act(async () => {
    first.resolve(reply({ liked: true, likeCount: 1 }));
  });
  expect(a).toHaveTextContent("1");
});

it("reuses a comment request id after a lost response and avoids duplicate delivery", async () => {
  const attempts: { body: string; requestId: string }[] = [];
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === "/api/gallery?limit=60") return reply([item("a")]);
    if (init?.method !== "POST") return reply([]);
    const payload = JSON.parse(String(init.body));
    attempts.push(payload);
    if (attempts.length === 1) throw new TypeError("Response lost");
    return reply({
      id: "comment-1",
      gallery_id: "a",
      user_id: account.id,
      body: payload.body,
      author_name: "作者",
      created_at: "2026-11-15",
      can_delete: true,
      comment_count: 1,
    });
  });
  render(<GalleryPage />);
  await screen.findByRole("heading", { name: "作品a" });
  fireEvent.click(screen.getByRole("button", { name: "查看作品a的评论" }));
  const section = await screen.findByRole("region", { name: "作品a的评论" });
  const draft = within(section).getByRole("textbox", { name: "给作品a评论" });
  fireEvent.change(draft, { target: { value: "想保留的评论" } });
  fireEvent.click(within(section).getByRole("button", { name: "发布评论" }));
  await screen.findByRole("alert");
  expect(draft).toHaveValue("想保留的评论");
  fireEvent.click(within(section).getByRole("button", { name: "发布评论" }));
  expect(await within(section).findByText("想保留的评论")).toBeInTheDocument();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
  expect(draft).toHaveValue("");
});

it("does not apply a previous account's late comment result or clear the new draft", async () => {
  const pending = deferred<Response>();
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === "/api/gallery?limit=60") return reply([item("a")]);
    if (init?.method === "POST") return pending.promise;
    return reply([]);
  });
  const view = render(<GalleryPage />);
  await screen.findByRole("heading", { name: "作品a" });
  fireEvent.click(screen.getByRole("button", { name: "查看作品a的评论" }));
  const draft = await screen.findByRole("textbox", { name: "给作品a评论" });
  fireEvent.change(draft, { target: { value: "旧账号评论" } });
  fireEvent.click(screen.getByRole("button", { name: "发布评论" }));
  account.id = "user-2";
  view.rerender(<GalleryPage />);
  await act(async () => {
    pending.resolve(
      reply({
        id: "old",
        gallery_id: "a",
        user_id: "user-1",
        body: "旧账号评论",
        author_name: "旧用户",
        created_at: "2026-11-15",
        can_delete: true,
      }),
    );
  });
  expect(screen.queryByText("旧用户")).not.toBeInTheDocument();
});

it("uses the server count when retrying a saved comment after refreshing the gallery", async () => {
  let saved = false;
  const requests: string[] = [];
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === "/api/gallery?limit=60")
      return reply([{ ...item("a"), comment_count: saved ? 1 : 0 }]);
    if (init?.method !== "POST") return reply([]);
    requests.push(String(init.body));
    if (!saved) {
      saved = true;
      throw new TypeError("response lost");
    }
    return reply({
      id: "once",
      gallery_id: "a",
      user_id: account.id,
      body: "一次评论",
      author_name: "作者",
      created_at: "2026-11-15",
      can_delete: true,
      comment_count: 1,
    });
  });
  render(<GalleryPage />);
  await screen.findByRole("heading", { name: "作品a" });
  fireEvent.click(screen.getByRole("button", { name: "查看作品a的评论" }));
  const draft = await screen.findByRole("textbox", { name: "给作品a评论" });
  fireEvent.change(draft, { target: { value: "一次评论" } });
  fireEvent.click(screen.getByRole("button", { name: "发布评论" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "重新加载作品" }));
  await screen.findByText("1 件作品 · 1 条讨论");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "发布评论" }));
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toBe(requests[1]);
  expect(screen.getByText("1 件作品 · 1 条讨论")).toBeInTheDocument();
  expect(screen.queryByText("1 件作品 · 2 条讨论")).not.toBeInTheDocument();
});

it("retries a failed media preview without removing its discussion or navigating away", async () => {
  fetchMock.mockResolvedValue(reply([item("a")]));
  render(<GalleryPage />);
  const preview = await screen.findByRole("img", { name: "作品a" });
  fireEvent.error(preview);
  expect(screen.getByRole("alert")).toHaveTextContent("无法读取");
  expect(
    screen.getByRole("button", { name: "查看作品a的评论" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新加载媒体" }));
  expect(screen.getByRole("img", { name: "作品a" })).toHaveAttribute(
    "src",
    "/api/gallery/a/media",
  );
});

it("distinguishes a failed discussion from an empty one and retries in place", async () => {
  fetchMock
    .mockResolvedValueOnce(reply([item("a")]))
    .mockResolvedValueOnce(reply([], 503))
    .mockResolvedValueOnce(reply([]));
  render(<GalleryPage />);
  await screen.findByRole("heading", { name: "作品a" });
  fireEvent.click(screen.getByRole("button", { name: "查看作品a的评论" }));
  const section = await screen.findByRole("region", { name: "作品a的评论" });
  expect(await within(section).findByRole("alert")).toHaveTextContent(
    "暂不可用",
  );
  expect(
    within(section).queryByText("还没有评论，来开启讨论吧"),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(section).getByRole("button", { name: "重试加载评论" }),
  );
  expect(
    await within(section).findByText("还没有评论，来开启讨论吧"),
  ).toBeInTheDocument();
});

it("reconciles a removed comment after the delete response is lost", async () => {
  let removed = false;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url) === "/api/gallery?limit=60")
      return reply([{ ...item("a"), comment_count: removed ? 0 : 1 }]);
    if (init?.method === "DELETE") {
      removed = true;
      throw new TypeError("response lost");
    }
    return reply(
      removed
        ? []
        : [
            {
              id: "lost-delete",
              gallery_id: "a",
              user_id: "user-1",
              body: "待删除内容",
              author_name: "作者",
              created_at: "2026-11-15",
              can_delete: true,
            },
          ],
    );
  });
  render(<GalleryPage />);
  await screen.findByRole("heading", { name: "作品a" });
  fireEvent.click(screen.getByRole("button", { name: "查看作品a的评论" }));
  fireEvent.click(await screen.findByRole("button", { name: "删除评论" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "刷新作品a的评论" }));
  await screen.findByText("还没有评论，来开启讨论吧");
  expect(screen.queryByText("待删除内容")).not.toBeInTheDocument();
});
