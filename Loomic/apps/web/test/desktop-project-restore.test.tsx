// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopProjectRestore } from "@/components/desktop-project-restore";
import type { DesktopStorageApi } from "@/lib/desktop-storage";
vi.mock("@/hooks/use-surface-entry", () => ({ useSurfaceEntry: () => undefined }));
afterEach(cleanup);
it("requires a preview and explicit confirmation before upload and opens the restored canvas", async () => {
  const api = { inspectLocalProject: vi.fn().mockResolvedValue({ id: "preview", name: "产品视频", elements: 3, sessions: 1, messages: 2, localMedia: 1, uploadBytes: 100, missingMedia: 0, fileName: "project.json" }), restoreLocalProject: vi.fn().mockResolvedValue({ projectId: "p", canvasId: "canvas", sessionId: "session", restored: true }) };
  render(<DesktopProjectRestore api={api as unknown as DesktopStorageApi} accountId="owner" accessToken="token" disabled={false}/>);
  await userEvent.click(screen.getByRole("button", { name: "从本地快照恢复工程" }));
  expect(await screen.findByText("产品视频")).toBeInTheDocument();
  expect(api.restoreLocalProject).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "确认恢复" })).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "确认恢复" }));
  expect(await screen.findByRole("link", { name: "打开恢复的画布" })).toHaveAttribute("href", "/desktop-app/canvas/?id=canvas&session=session");
  expect(api.restoreLocalProject).toHaveBeenCalledOnce();
});
it("blocks restoration of missing media and cancellation makes no write request", async () => {
  const api = { inspectLocalProject: vi.fn().mockResolvedValue({ id: "preview", name: "缺失文件", elements: 1, sessions: 0, messages: 0, localMedia: 0, uploadBytes: 0, missingMedia: 1, fileName: "project.json" }), restoreLocalProject: vi.fn() };
  render(<DesktopProjectRestore api={api as unknown as DesktopStorageApi} accountId="owner" accessToken="token" disabled={false}/>);
  await userEvent.click(screen.getByRole("button", { name: "从本地快照恢复工程" }));
  expect(await screen.findByText(/1 个素材在本地和云端均不可用/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "确认恢复" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.restoreLocalProject).not.toHaveBeenCalled();
});
