import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopWorkbench } from "@/components/desktop-workbench";
vi.mock("next/dynamic", () => ({
  default:
    () =>
    ({ value, onChange }: { value: string; onChange(value: string): void }) => (
      <textarea
        aria-label="代码"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
}));
vi.mock("@/components/desktop-mcp-panel", () => ({
  DesktopMcpPanel: () => null,
}));
afterEach(() => {
  cleanup();
  delete (window as Window & { electronAPI?: unknown }).electronAPI;
});
it("keeps edits made during a save dirty until those exact contents are saved", async () => {
  const entries = [{ name: "draft.txt", path: "draft.txt", kind: "file" }];
  let finish!: (reply: unknown) => void;
  const api = {
    selectWorkspace: vi
      .fn()
      .mockResolvedValue({ root: "test-project", entries }),
    getWorkspaceTree: vi.fn().mockResolvedValue(entries),
    getWorkspaceScripts: vi.fn().mockResolvedValue([]),
    getWorkspaceGitStatus: vi.fn().mockResolvedValue(""),
    readWorkspaceFile: vi
      .fn()
      .mockResolvedValue({ path: "draft.txt", content: "original" }),
    writeWorkspaceFile: vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
    onWorkspaceScriptOutput: () => () => {},
    onWorkspaceScriptFinished: () => () => {},
  };
  (window as Window & { electronAPI?: unknown }).electronAPI = api;
  render(<DesktopWorkbench />);
  fireEvent.click(screen.getByRole("button", { name: /^打开项目$/ }));
  fireEvent.click(await screen.findByRole("button", { name: "draft.txt" }));
  const editor = await screen.findByRole("textbox", { name: "代码" });
  fireEvent.change(editor, { target: { value: "first edit" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  fireEvent.change(editor, { target: { value: "newer edit" } });
  await act(async () => finish({ path: "draft.txt", snapshotId: "snapshot" }));
  expect(api.writeWorkspaceFile).toHaveBeenCalledWith({
    path: "draft.txt",
    content: "first edit",
  });
  expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  expect(editor).toHaveValue("newer edit");
});
