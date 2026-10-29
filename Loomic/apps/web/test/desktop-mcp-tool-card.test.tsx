// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopMcpToolCard } from "@/components/chat/desktop-mcp-tool-card";
import { ToolBlockView } from "@/components/chat/tool-block-view";

vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "token" } }) }));
vi.mock("@/lib/server-api", () => ({
  approveWebsiteCaptureAction: vi.fn(), cancelJob: vi.fn(), cancelWebsiteCapture: vi.fn(), exportJob: vi.fn(),
  fetchDesktopAgentTask: vi.fn(), fetchDesktopAgentTasks: vi.fn(), fetchJob: vi.fn(), fetchJobs: vi.fn(), fetchJobTimeline: vi.fn(),
  fetchWebsiteCapture: vi.fn(), fetchWebsiteCaptureActions: vi.fn(), prepareWebsitePromo: vi.fn(), rejectWebsiteCaptureAction: vi.fn(),
  resolveDesktopAgentApproval: vi.fn(), retryWebsiteCapture: vi.fn(), syncJob: vi.fn(),
}));

afterEach(() => cleanup());

describe("DesktopMcpToolCard", () => {
  it("shows the screen action while hiding typed text and clipboard data", async () => {
    document.documentElement.lang = "en-US";
    render(<DesktopMcpToolCard block={{
      type: "tool", toolCallId: "call-1", toolName: "screen_type", status: "completed",
      input: { target: "Search field", value: "private prompt" },
      outputSummary: "Entered private prompt",
    }} />);

    expect(await screen.findByText("Type text")).toBeInTheDocument();
    expect(screen.getByText(/target: Search field/)).toBeInTheDocument();
    expect(screen.getByText(/value: \[hidden\]/)).toBeInTheDocument();
    expect(screen.getByText(/entered text is hidden/)).toBeInTheDocument();
    expect(screen.queryByText(/private prompt/)).not.toBeInTheDocument();
  });

  it("summarizes screen observations without exposing OCR text", async () => {
    document.documentElement.lang = "en-US";
    render(<DesktopMcpToolCard block={{
      type: "tool", toolCallId: "call-2", toolName: "screen_observe", status: "completed",
      output: { windowTitle: "Editor", controls: [{}, {}, {}], ocrText: "Sensitive visible text" },
    }} />);

    expect(await screen.findByText(/Screen inspected · Editor · 3 controls/)).toBeInTheDocument();
    expect(screen.queryByText("Sensitive visible text")).not.toBeInTheDocument();
  });

  it("renders screen MCP calls as visible tool blocks in chat", () => {
    document.documentElement.lang = "zh-CN";
    render(<ToolBlockView block={{
      type: "tool", toolCallId: "call-3", toolName: "screen_click", status: "completed",
      input: { target: "Save" }, output: { ok: true, x: 30, y: 40 },
    }} />);

    expect(screen.getByRole("region", { name: "桌面 MCP 工具调用" })).toBeInTheDocument();
    expect(screen.getByText("点击控件")).toBeInTheDocument();
    expect(screen.getByText(/target: Save/)).toBeInTheDocument();
  });
});
