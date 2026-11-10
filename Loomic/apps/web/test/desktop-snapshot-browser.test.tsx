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
