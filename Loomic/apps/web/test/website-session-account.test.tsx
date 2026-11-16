import "@testing-library/jest-dom/vitest";
import { WebsiteSessionManager } from "@/components/agent-browser/session-manager";
import type { SavedWebsiteSession } from "@/lib/website-journey-api";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ list: vi.fn(), revoke: vi.fn() }));
vi.mock("@/lib/website-journey-api", () => ({
  listWebsiteSessions: api.list,
  forgetWebsiteSession: api.revoke,
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise not initialized");
  };
  let reject: (cause: Error) => void = () => {
    throw new Error("Promise not initialized");
  };
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function saved(id: string): SavedWebsiteSession {
  return {
    id,
    origin: `https://${id}.example.test`,
    expiresAt: "2027-01-01T00:00:00Z",
  };
}

function openSessions() {
  fireEvent.click(screen.getByRole("button", { name: /网站登录会话.*管理/ }));
}

beforeEach(() => {
  api.list.mockReset().mockResolvedValue([saved("current")]);
  api.revoke.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("clears the previous token's saved sessions before the next list arrives", async () => {
  api.list
    .mockResolvedValueOnce([saved("old-private")])
    .mockReturnValueOnce(new Promise(() => {}));
  const view = render(<WebsiteSessionManager token="old-token" />);
  openSessions();
  await screen.findByText(saved("old-private").origin);
  view.rerender(<WebsiteSessionManager token="new-token" />);
  expect(
    screen.queryByText(saved("old-private").origin),
  ).not.toBeInTheDocument();
  openSessions();
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith("new-token"));
  expect(screen.getByRole("status")).toHaveTextContent("正在更新");
});

it("ignores a previous token's list that completes after the current one", async () => {
  const previous = deferred<SavedWebsiteSession[]>();
  api.list.mockReturnValueOnce(previous.promise);
  const view = render(<WebsiteSessionManager token="old-token" />);
  openSessions();
  view.rerender(<WebsiteSessionManager token="new-token" />);
  if (!screen.queryByRole("button", { name: "刷新会话" })) openSessions();
  await screen.findByText(saved("current").origin);
  await act(async () => previous.resolve([saved("old-private")]));
  expect(
    screen.queryByText(saved("old-private").origin),
  ).not.toBeInTheDocument();
  expect(screen.getByText(saved("current").origin)).toBeInTheDocument();
});

it("ignores an old list failure without ending the current loading state", async () => {
  const previous = deferred<SavedWebsiteSession[]>();
  const current = deferred<SavedWebsiteSession[]>();
  api.list
    .mockReturnValueOnce(previous.promise)
    .mockReturnValueOnce(current.promise);
  const view = render(<WebsiteSessionManager token="old-token" />);
  openSessions();
  view.rerender(<WebsiteSessionManager token="new-token" />);
  if (!screen.queryByRole("button", { name: "刷新会话" })) openSessions();
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  await act(async () => previous.reject(new Error("old private list error")));
  expect(screen.queryByText("old private list error")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "刷新会话" })).toBeDisabled();
  await act(async () => current.resolve([saved("current")]));
  expect(screen.getByText(saved("current").origin)).toBeInTheDocument();
});

it("does not broadcast or display a previous token's late revocation", async () => {
  const previous = deferred<void>();
  api.revoke.mockReturnValueOnce(previous.promise);
  const changed = vi.fn();
  window.addEventListener("loomic:website-sessions-changed", changed);
  try {
    const view = render(<WebsiteSessionManager token="old-token" />);
    openSessions();
    await screen.findByText(saved("current").origin);
    fireEvent.click(screen.getByRole("button", { name: "立即撤销" }));
    view.rerender(<WebsiteSessionManager token="new-token" />);
    if (!screen.queryByRole("button", { name: "刷新会话" })) openSessions();
    await screen.findByText(saved("current").origin);
    await act(async () => previous.resolve());
    expect(changed).not.toHaveBeenCalled();
    expect(screen.queryByText(/登录会话已撤销/)).not.toBeInTheDocument();
    expect(screen.getByText(saved("current").origin)).toBeInTheDocument();
  } finally {
    window.removeEventListener("loomic:website-sessions-changed", changed);
  }
});

it("does not broadcast a late revocation after leaving the manager", async () => {
  const previous = deferred<void>();
  api.revoke.mockReturnValueOnce(previous.promise);
  const changed = vi.fn();
  window.addEventListener("loomic:website-sessions-changed", changed);
  try {
    const view = render(<WebsiteSessionManager token="old-token" />);
    openSessions();
    await screen.findByText(saved("current").origin);
    fireEvent.click(screen.getByRole("button", { name: "立即撤销" }));
    view.unmount();
    await act(async () => previous.resolve());
    expect(changed).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("loomic:website-sessions-changed", changed);
  }
});

it("keeps current-token revocation and its refresh event working", async () => {
  api.list.mockResolvedValueOnce([saved("current"), saved("keep")]);
  const changed = vi.fn();
  window.addEventListener("loomic:website-sessions-changed", changed);
  try {
    render(<WebsiteSessionManager token="current-token" />);
    openSessions();
    await screen.findByText(saved("current").origin);
    const [revoke] = screen.getAllByRole("button", { name: "立即撤销" });
    if (!revoke) throw new Error("Saved session revoke button is missing");
    fireEvent.click(revoke);
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(api.revoke).toHaveBeenCalledWith("current-token", "current");
    expect(screen.queryByText(saved("current").origin)).not.toBeInTheDocument();
    expect(screen.getByText(saved("keep").origin)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("登录会话已撤销");
  } finally {
    window.removeEventListener("loomic:website-sessions-changed", changed);
  }
});

it("does not re-read a session being revoked when the manager is reopened", async () => {
  const revocation = deferred<void>();
  api.revoke.mockReturnValueOnce(revocation.promise);
  render(<WebsiteSessionManager token="current-token" />);
  openSessions();
  await screen.findByText(saved("current").origin);
  fireEvent.click(screen.getByRole("button", { name: "立即撤销" }));
  fireEvent.click(screen.getByRole("button", { name: /网站登录会话.*收起/ }));
  openSessions();
  expect(api.list).toHaveBeenCalledOnce();
  await act(async () => revocation.resolve());
  expect(screen.queryByText(saved("current").origin)).not.toBeInTheDocument();
});

it("can retry a failed current-token list", async () => {
  api.list.mockRejectedValueOnce(new Error("current list unavailable"));
  render(<WebsiteSessionManager token="current-token" />);
  openSessions();
  await screen.findByText("current list unavailable");
  fireEvent.click(screen.getByRole("button", { name: "刷新会话" }));
  await screen.findByText(saved("current").origin);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
