import "@testing-library/jest-dom/vitest";
import { DesktopDownloadList } from "@/components/desktop-download-list";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/components/desktop-toast", () => ({ useDesktopToast: () => toast }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toast.push.mockReset();
});
function manifest(version = "0.2.2") {
  return new Response(
    JSON.stringify({
      platform: "windows-x64",
      version,
      fileName: `Helstera-${version}.exe`,
      sha256: "a".repeat(64),
      publishedAt: "2026-11-15T00:00:00Z",
    }),
  );
}
function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it("removes an explicitly withdrawn manifest while retaining unrelated downloads", async () => {
  let reads = 0;
  const fetch = vi.fn(async (url: string) => {
    reads++;
    if (!url.includes("windows-x64"))
      return new Response(null, { status: 404 });
    return reads <= 4 ? manifest() : new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  const view = render(<DesktopDownloadList locale="zh-CN" />);
  await screen.findByRole("link", { name: /v0.2.2/ });
  view.rerender(<DesktopDownloadList locale="en-US" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(8));
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: /v0.2.2/ }),
    ).not.toBeInTheDocument(),
  );
});

it("keeps the last known package on transient failure and provides a retry", async () => {
  let round = 0;
  const fetch = vi.fn(async (url: string) => {
    if (!url.includes("windows-x64"))
      return new Response(null, { status: 404 });
    round++;
    if (round === 2) throw new Error("temporary network failure");
    return manifest(round === 1 ? "0.2.2" : "0.2.3");
  });
  vi.stubGlobal("fetch", fetch);
  const view = render(<DesktopDownloadList locale="zh-CN" />);
  await screen.findByRole("link", { name: /v0.2.2/ });
  view.rerender(<DesktopDownloadList locale="en-US" />);
  await waitFor(() => expect(toast.push).toHaveBeenCalled());
  expect(screen.getByRole("link", { name: /v0.2.2/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Read versions again" }));
  expect(
    await screen.findByRole("link", { name: /v0.2.3/ }),
  ).toBeInTheDocument();
});

it("does not restore revoked links or toast failures from an older locale read", async () => {
  const obsolete = deferred();
  let calls = 0;
  const fetch = vi.fn((url: string) => {
    const round = Math.floor(calls++ / 4);
    if (!url.includes("windows-x64"))
      return Promise.resolve(new Response(null, { status: 404 }));
    return round === 0
      ? Promise.resolve(manifest())
      : round === 1
        ? obsolete.promise
        : Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetch);
  const view = render(<DesktopDownloadList locale="zh-CN" />);
  await screen.findByRole("link", { name: /v0.2.2/ });
  view.rerender(<DesktopDownloadList locale="en-US" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(8));
  view.rerender(<DesktopDownloadList locale="zh-CN" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(12));
  await screen.findByText("暂无下载记录");
  const notices = toast.push.mock.calls.length;
  await act(async () => {
    obsolete.resolve(manifest("0.2.1"));
  });
  expect(
    screen.queryByRole("link", { name: /v0.2.1/ }),
  ).not.toBeInTheDocument();
  expect(toast.push).toHaveBeenCalledTimes(notices);
});

it("cancels unmounted reads and does not emit a late failure notice", async () => {
  const pending = deferred();
  const fetch = vi.fn((_url: string, _init?: RequestInit) => pending.promise);
  vi.stubGlobal("fetch", fetch);
  const view = render(<DesktopDownloadList locale="zh-CN" />);
  view.unmount();
  expect(fetch.mock.calls.every((call) => call[1]?.signal?.aborted)).toBe(true);
  await act(async () => {
    pending.reject(new Error("late failure"));
  });
  expect(toast.push).not.toHaveBeenCalled();
});

it("does not report an empty catalog when one platform's publication state is unknown", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("windows-x64")) throw new Error("temporary failure");
      return new Response(null, { status: 404 });
    }),
  );
  render(<DesktopDownloadList locale="zh-CN" />);
  await waitFor(() => expect(toast.push).toHaveBeenCalled());
  expect(screen.queryByText("暂无下载记录")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重新读取版本" })).toBeEnabled();
});
