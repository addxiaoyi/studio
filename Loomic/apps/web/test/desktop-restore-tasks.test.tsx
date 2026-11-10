// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopRestoreTasks } from "@/components/desktop-restore-tasks";
import type { DesktopStorageApi } from "@/lib/desktop-storage";
vi.mock("@/hooks/use-surface-entry", () => ({ useSurfaceEntry: () => undefined }));
afterEach(cleanup);
it("previews resumed work and requires confirmation before clearing only its temporary upload", async () => {
  const api = { getRestoreTasks: vi.fn().mockResolvedValue({ tasks: [{ id: "task", name: "本地录像", status: "paused", uploads: [{ uploadId: "upload" }] }], uploads: [{ uploadId: "upload", filename: "video.mp4", storedBytes: 8 * 1024 ** 2, offset: 8 * 1024 ** 2, bytes: 40 * 1024 ** 2, expiresAt: "2026-11-10T12:00:00Z" }] }), clearRestoreTask: vi.fn().mockResolvedValue({ ok: true }) };
  const resume = vi.fn();
  render(<DesktopRestoreTasks api={api as unknown as DesktopStorageApi} accountId="owner" accessToken="token" disabled={false} onResume={resume}/>);
  await userEvent.click(screen.getByRole("button", { name: "恢复与上传任务" }));
  await screen.findByText("本地录像");
  await userEvent.click(screen.getByRole("button", { name: "清理云端暂存" }));
  expect(api.clearRestoreTask).not.toHaveBeenCalled();
  api.getRestoreTasks.mockResolvedValueOnce({ tasks: [{ id: "task", name: "本地录像", status: "cleared", uploads: [{ uploadId: "upload" }] }], uploads: [] });
  await userEvent.click(screen.getByRole("button", { name: "确认清理暂存" }));
  await waitFor(() => expect(api.clearRestoreTask).toHaveBeenCalledWith("task", { accountId: "owner", accessToken: "token" }));
  await userEvent.click(screen.getByRole("button", { name: "继续前预览" }));
  expect(resume).toHaveBeenCalledWith("task");
});
