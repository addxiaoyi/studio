// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopAgentProgressCard } from "@/components/chat/desktop-agent-progress-card";

const mocks = vi.hoisted(() => ({ fetchDesktopAgentTask: vi.fn(), resolveDesktopAgentApproval: vi.fn(), cancelDesktopAgentTask: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "token" } }) }));
vi.mock("@/lib/server-api", () => mocks);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("DesktopAgentProgressCard", () => {
  it("queries a single task and shows mode, reobserve, recording, and an in-page preview", async () => {
    document.documentElement.lang = "zh-CN";
    mocks.fetchDesktopAgentTask.mockResolvedValue({
      taskId: "task-1", goal: "Inspect desktop", role: "operator", capabilities: ["screen.read"], canvasId: "00000000-0000-0000-0000-000000000099",
      executionMode: "windows_ui", status: "succeeded", error: null, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z",
      result: {
        screenshotAsset: { url: "https://studio.0st.top/assets/screen.png" },
        recordingAsset: { url: "https://studio.0st.top/assets/recording.webm" },
      },
      events: [
        { eventType: "step", stepId: "reobserve", detail: "Plan exhausted; requesting round 2 from the planner.", createdAt: "2026-10-26T00:00:00Z" },
        { eventType: "visual_grounding", detail: "Target grounded at (18, 42)", createdAt: "2026-10-26T00:00:01Z" },
        { eventType: "approval_expired", detail: "Approval expired; the action was not run.", createdAt: "2026-10-26T00:00:02Z" },
      ],
      pendingApprovals: [],
    });
    const user = userEvent.setup();
    render(<DesktopAgentProgressCard taskId="task-1" />);

    expect(await screen.findByText(/本机控件树 \/ Windows UI/)).toBeInTheDocument();
    expect(screen.getByText(/第 2 轮：重新观察并规划/)).toBeInTheDocument();
    expect(screen.getByText("视觉定位完成")).toBeInTheDocument();
    expect(screen.getByText("审批已过期，此操作未执行。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "在画布中查看" })).toHaveAttribute("href", expect.stringContaining("00000000-0000-0000-0000-000000000099"));
    expect(mocks.fetchDesktopAgentTask).toHaveBeenCalledWith("token", "task-1");
    await user.click(screen.getByRole("button", { name: "预览截图" }));
    expect(screen.getByRole("dialog", { name: "任务截图" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭预览" }));
    await user.click(screen.getByRole("button", { name: /预览录屏/ }));
    expect(screen.getByRole("dialog", { name: "录屏草稿" })).toBeInTheDocument();
    expect(document.querySelector("video")?.getAttribute("src")).toContain("recording.webm");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
