// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebsiteAssistantSettings } from "@/components/website-assistant-settings";

const mocks = vi.hoisted(() => ({
  createDesktopAgentTask: vi.fn(),
  createWebsiteCapturePairing: vi.fn(),
  fetchDesktopAgentTasks: vi.fn(),
  fetchWebsiteAssistantConnection: vi.fn(),
  resolveDesktopAgentApproval: vi.fn(),
  revokeWebsiteAssistant: vi.fn(),
  setWebsiteAssistantPaused: vi.fn(),
  cancelDesktopAgentTask: vi.fn(),
}));

vi.mock("@/lib/server-api", () => mocks);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchDesktopAgentTasks.mockResolvedValue([]);
  mocks.fetchWebsiteAssistantConnection.mockResolvedValue(null);
  mocks.createDesktopAgentTask.mockResolvedValue({ taskId: "task-1" });
});

afterEach(() => cleanup());

describe("WebsiteAssistantSettings execution mode", () => {
  it("keeps screen.read required and blocks submission until the desktop is connected", async () => {
    const user = userEvent.setup();
    render(<WebsiteAssistantSettings accessToken="token" />);

    await user.selectOptions(screen.getByLabelText("执行模式"), "windows_ui");
    await user.type(screen.getByLabelText("任务目标"), "Open Notepad");

    const screenRead = screen.getByRole("checkbox", { name: /screen\.read/ });
    expect(screenRead).toBeChecked();
    expect(screenRead).toBeDisabled();
    expect(screen.getByRole("button", { name: "开始桌面任务" })).toBeDisabled();
  });

  it("submits the selected native mode with its required capability", async () => {
    mocks.fetchWebsiteAssistantConnection.mockResolvedValue({
      id: "connection-1", status: "connected", browser: "unknown", platform: "windows",
      clientKind: "desktop-app", connectedAt: "2026-10-26T00:00:00.000Z",
      lastSeenAt: "2026-10-26T00:00:00.000Z", paused: false,
    });
    const user = userEvent.setup();
    render(<WebsiteAssistantSettings accessToken="token" />);

    await user.selectOptions(screen.getByLabelText("执行模式"), "windows_ui");
    await user.type(screen.getByLabelText("任务目标"), "Open Notepad");
    await waitFor(() => expect(screen.getByRole("button", { name: "开始桌面任务" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "开始桌面任务" }));

    await waitFor(() => expect(mocks.createDesktopAgentTask).toHaveBeenCalledWith("token", expect.objectContaining({
      executionMode: "windows_ui",
      capabilities: expect.arrayContaining(["screen.read", "window.focus", "window.click"]),
    })));
  });
});
