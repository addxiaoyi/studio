// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StudioAiEditorPanel } from "@/components/studio-ai-editor-panel";
import { completeStudioPlan, confirmStudioPlan, normalizeModelPlan, requestStudioAiPlan } from "@/lib/studio-ai-edit";
import { clearStudioPlan, saveStudioPlan } from "@/lib/visualforge-storage";
import { readRecoveredStudioSession } from "@/lib/studio-ai-session";
import type { StudioRuntime } from "@/lib/visualforge-runtime";

vi.mock("@/lib/visualforge-storage", () => ({ saveStudioPlan: vi.fn(), clearStudioPlan: vi.fn() }));
vi.mock("@/lib/studio-ai-session", () => ({ readRecoveredStudioSession: vi.fn() }));
vi.mock("@/lib/studio-ai-edit", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/studio-ai-edit")>(), requestStudioAiPlan: vi.fn(), confirmStudioPlan: vi.fn(), completeStudioPlan: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => "zh-CN" }));

const original = { compositionId: "MyComp", revision: "a".repeat(64), duration: 2, format: "landscape" as const, captions: [], cut: null };
const approval = { id: "123e4567-e89b-42d3-a456-426614174000", fingerprint: "b".repeat(64), expiresAt: "2099-01-01T00:00:00Z", estimatedCredits: 0 as const };
const planned = { ...normalizeModelPlan({ summary: "保留画面并加标题", actions: [{ type: "caption", text: "新品上市", startMs: 0, endMs: 1000 }] }, original), approval };
function editor() {
  let revision = original.revision, id = original.compositionId;
  const runtime = { listMedia: () => [], projectId: () => id, snapshot: vi.fn(async () => ({ ...original, revision, compositionId: id })),
    applyEdit: vi.fn(async () => { revision = "b".repeat(64); }), undoEdit: vi.fn(async () => { revision = original.revision; }), openExport: vi.fn() };
  return { runtime, change: () => { revision = "c".repeat(64); }, switchVideo: () => { id = "Other"; } };
}
async function preview(runtime: ReturnType<typeof editor>["runtime"]) {
  render(<StudioAiEditorPanel runtime={runtime as unknown as StudioRuntime} token="test" userId="u" mediaRevision={1} exported={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "添加标题" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "添加标题" }));
  expect(requestStudioAiPlan).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "预览修改方案" }));
  await screen.findByText("确认这些修改");
}
beforeEach(() => {
  vi.mocked(readRecoveredStudioSession).mockResolvedValue(null);
  vi.mocked(saveStudioPlan).mockResolvedValue("u");
  vi.mocked(requestStudioAiPlan).mockResolvedValue(planned);
  vi.mocked(confirmStudioPlan).mockResolvedValue({ id: approval.id, compositionId: "MyComp", revision: original.revision, cut: planned.cut, replaceVideo: false });
  vi.mocked(completeStudioPlan).mockResolvedValue(undefined);
  vi.mocked(clearStudioPlan).mockResolvedValue(undefined);
});

it("keeps an action undo when saving the panel fails and recovers it without another mutation", async () => {
  const partial = { ...original, revision: "d".repeat(64), editReceipt: { id: approval.id, revision: "d".repeat(64), originalRevision: original.revision, undone: [0], complete: false, canUndo: true } };
  const complex = { ...normalizeModelPlan({ summary: "字幕与配乐", actions: [{ type: "caption", text: "新品上市", startMs: 0, endMs: 1000 }, { type: "audio", assetName: "music.wav", startMs: 0, volume: 0.3 }] }, original), approval };
  vi.mocked(readRecoveredStudioSession).mockResolvedValue({ plan: complex, appliedRevision: "b".repeat(64), receiptSynced: true, actionUndoAvailable: true, exportedOnce: true });
  vi.mocked(saveStudioPlan).mockRejectedValueOnce(new Error("本机方案保存失败"));
  const { runtime } = editor();
  const undoAction = vi.fn(async () => partial);
  const props = { runtime: { ...runtime, undoAction } as unknown as StudioRuntime, token: "test", userId: "u", mediaRevision: 1, exported: vi.fn() };
  const view = render(<StudioAiEditorPanel {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "撤销动作 1" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "撤销动作 1" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("本机方案保存失败");
  expect(screen.queryByRole("button", { name: "撤销动作 1" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "撤销动作 2" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "导出当前版本" })).toBeEnabled();
  view.unmount();
  vi.mocked(readRecoveredStudioSession).mockResolvedValue({ plan: complex, appliedRevision: partial.revision, receiptSynced: true, undoneActions: [0], actionUndoAvailable: true, exportedOnce: true });
  render(<StudioAiEditorPanel {...props} />);
  await waitFor(() => expect(screen.getByText("已撤销", { exact: true })).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "导出当前版本" }));
  await waitFor(() => expect(runtime.openExport).toHaveBeenCalledOnce());
  expect(undoAction).toHaveBeenCalledOnce();expect(runtime.applyEdit).not.toHaveBeenCalled();
  expect(confirmStudioPlan).not.toHaveBeenCalled();expect(completeStudioPlan).not.toHaveBeenCalled();
});
afterEach(() => { cleanup();vi.clearAllMocks(); });

it("guides preview, explicit approval, application, export and guarded undo", async () => {
  const { runtime } = editor();await preview(runtime);
  expect(screen.getByRole("button", { name: "确认并应用修改" })).toBeDisabled();
  expect(runtime.applyEdit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认并应用修改" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled());
  expect(runtime.applyEdit).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "导出视频" }));
  await waitFor(() => expect(runtime.openExport).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole("button", { name: "撤销本次修改" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "撤销本次修改" }));
  await waitFor(() => expect(runtime.undoEdit).toHaveBeenCalledWith({ id: approval.id, compositionId: "MyComp", appliedRevision: "b".repeat(64), originalRevision: original.revision }));
  expect(await screen.findByText("已撤销本次修改，可以调整要求后重新预览方案。")).toBeVisible();
});

it("invalidates a plan when its request changes and rejects manual timeline changes", async () => {
  const { runtime, change } = editor();await preview(runtime);
  fireEvent.change(screen.getByLabelText("描述视频编辑目标"), { target: { value: "新要求" } });
  expect(screen.queryByRole("button", { name: "确认并应用修改" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "预览修改方案" }));await screen.findByText("确认这些修改");
  fireEvent.click(screen.getByRole("checkbox"));change();
  fireEvent.click(screen.getByRole("button", { name: "确认并应用修改" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("已改变");
  expect(confirmStudioPlan).not.toHaveBeenCalled();expect(runtime.applyEdit).not.toHaveBeenCalled();
});

it("retries a lost receipt without applying the edit twice", async () => {
  vi.mocked(completeStudioPlan).mockRejectedValueOnce(new Error("network unavailable"));
  const { runtime } = editor();await preview(runtime);
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button", { name: "确认并应用修改" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "重试同步记录" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "导出视频" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重试同步记录" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "重试同步记录" })).not.toBeInTheDocument());
  expect(runtime.applyEdit).toHaveBeenCalledOnce();expect(completeStudioPlan).toHaveBeenCalledTimes(2);
});

it("does not accept music the user did not choose", async () => {
  vi.mocked(requestStudioAiPlan).mockResolvedValue({ ...planned, actions: [{ type: "audio", status: "planned", label: "意外音乐" }] });
  const { runtime } = editor();
  render(<StudioAiEditorPanel runtime={runtime as unknown as StudioRuntime} token="test" userId="u" mediaRevision={1} exported={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "添加标题" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "添加标题" }));
  fireEvent.click(screen.getByRole("button", { name: "预览修改方案" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未选择的音乐");
  expect(screen.queryByRole("button", { name: "确认并应用修改" })).not.toBeInTheDocument();
  expect(runtime.applyEdit).not.toHaveBeenCalled();
});
