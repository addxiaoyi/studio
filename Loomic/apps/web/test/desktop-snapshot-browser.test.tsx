// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopSnapshotBrowser } from "@/components/desktop-snapshot-browser";
import type { DesktopStorageApi } from "@/lib/desktop-storage";
vi.mock("@/hooks/use-surface-entry", () => ({ useSurfaceEntry: () => undefined }));
afterEach(cleanup);
it("filters local snapshots and opens only a preview without restoring or uploading", async () => {
  const snapshots = [{ id: "old", projectId: "p", name: "产品视频", fileName: "one.json", savedAt: "2026-01-01T00:00:00Z", elements: 1, sessions: 1, messages: 2, bytes: 100 }, { id: "new", projectId: "q", name: "网站演示", fileName: "two.json", savedAt: "2026-02-01T00:00:00Z", elements: 2, sessions: 1, messages: 3, bytes: 200 }];
  const api = { listLocalSnapshots: vi.fn().mockResolvedValue({ snapshots, unreadable: 0, truncated: false }), previewLocalSnapshot: vi.fn(), restoreLocalProject: vi.fn() };
  const onPreview = vi.fn();
  render(<DesktopSnapshotBrowser api={api as unknown as DesktopStorageApi} accountId="owner" accessToken="token" disabled={false} onPreview={onPreview}/>);
  await userEvent.click(screen.getByRole("button", { name: "浏览本地快照" }));
  expect(await screen.findByText("网站演示", { exact: true })).toBeInTheDocument();
  await userEvent.type(screen.getByRole("searchbox"), "产品");
  expect(within(screen.getByRole("list", { name: "本地快照列表" })).queryByText("网站演示")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /预览 产品视频/ }));
  expect(onPreview).toHaveBeenCalledWith("old");
  expect(api.restoreLocalProject).not.toHaveBeenCalled();
});
it("shows an offline overview and version differences without starting cloud restoration", async () => {
  const api = { listLocalSnapshots: vi.fn().mockResolvedValue({ snapshots: [{ id: "local", projectId: "p", name: "离线工程", fileName: "one.json", savedAt: "2026-11-10T00:00:00Z", elements: 2, sessions: 1, messages: 2, bytes: 100 }], unreadable: 0, truncated: false }), previewLocalSnapshot: vi.fn(), getLocalSnapshotOverview: vi.fn().mockResolvedValue({ name: "离线工程", thumbnail: "data:image/svg+xml;base64,PHN2Zy8+", text: ["本机文字"], messages: [], versions: [], baseline: null, difference: { elements: { added: 1, changed: 1, removed: 0 }, messages: { added: 2, changed: 0, removed: 0 }, settingsChanged: false, mediaChanged: false } }), queueLocalSnapshot: vi.fn().mockResolvedValue({}) };
  const preview = vi.fn();
  render(<DesktopSnapshotBrowser api={api as unknown as DesktopStorageApi} accountId="owner" accessToken={undefined} disabled={false} onPreview={preview}/>);
  await userEvent.click(screen.getByRole("button", { name: "浏览本地快照" }));
  await userEvent.click(await screen.findByRole("button", { name: /预览 离线工程/ }));
  expect(await screen.findByText("元素：新增 1 · 修改 1 · 移除 0")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "联网检查并恢复" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "加入待恢复列表" }));
  expect(api.queueLocalSnapshot).toHaveBeenCalledWith("local", "owner");
  expect(preview).not.toHaveBeenCalled();
});
