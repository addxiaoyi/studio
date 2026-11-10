// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolBlockView } from "@/components/chat/tool-block-view";

const api = vi.hoisted(() => ({
  fetchWebsiteCapture: vi.fn(),
  fetchWebsiteCaptureActions: vi.fn(),
  retryWebsiteCapture: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "token" } }) }));
vi.mock("@/lib/server-api", () => ({
  ...api,
  approveWebsiteCaptureAction: vi.fn(), cancelJob: vi.fn(), cancelWebsiteCapture: vi.fn(), exportJob: vi.fn(),
  fetchDesktopAgentTask: vi.fn(), fetchDesktopAgentTasks: vi.fn(), fetchJob: vi.fn(), fetchJobs: vi.fn(), fetchJobTimeline: vi.fn(),
  prepareWebsitePromo: vi.fn(), rejectWebsiteCaptureAction: vi.fn(), resolveDesktopAgentApproval: vi.fn(), syncJob: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("website recording in chat", () => {
  it("renders website introductions as semantic Markdown", async () => {
    api.fetchWebsiteCapture.mockResolvedValue({
      task: { status: "succeeded", progress: 100, result: { introduction: "## Example Domain\n\n**网站定位**：公开示例\n\n- [访问网站](https://example.com)\n\n<script>alert(1)</script>", pages: [] } },
      events: [],
    });
    const view = render(<ToolBlockView block={{ type: "tool", toolCallId: "capture-md", toolName: "website_capture", status: "completed", output: { taskId: "task-md" } }} />);
    expect(await screen.findByRole("heading", { name: "Example Domain", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("网站定位").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "访问网站" })).toHaveAttribute("href", "https://example.com");
    expect(view.container.querySelector("script")).toBeNull();
  });
  it("renders a saved video export using authenticated asset access", async () => {
    const assetId = "123e4567-e89b-42d3-a456-426614174000";
    const fetchVideo = vi.fn().mockResolvedValue(Response.json({ok:true,data:{path:`/api/uploads/${assetId}/file`,mimeType:"video/mp4",byteSize:3,expiresAt:null,grantSeconds:300}}));
    const NativeURL = globalThis.URL;
    vi.stubGlobal("fetch", fetchVideo);
    vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL: vi.fn(() => "blob:export"), revokeObjectURL: vi.fn() }));
    render(<ToolBlockView block={{ type: "tool", toolCallId: "export-1", toolName: "video_export", status: "completed", output: { assetId } }} />);
    expect(await screen.findByLabelText("视频成片")).toHaveAttribute("src", expect.stringContaining(`/api/uploads/${assetId}/file`));
    expect(screen.getByLabelText("视频成片")).toHaveAttribute("crossorigin","use-credentials");
    expect(fetchVideo).toHaveBeenCalledWith(expect.stringContaining(`/api/uploads/${assetId}/playback`), expect.objectContaining({method:"POST",credentials:"include",headers:{Authorization:"Bearer token"},redirect:"error"}));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("restores the video after remount without depending on the pending actions endpoint", async () => {
    api.fetchWebsiteCapture.mockResolvedValue({
      task: { status: "succeeded", progress: 100, result: { introduction: "Website overview", pages: [], recordingUrl: "/uploads/recording.webm" } },
      events: [],
    });
    api.fetchWebsiteCaptureActions.mockRejectedValue(new Error("actions unavailable"));
    const block = { type: "tool" as const, toolCallId: "capture-1", toolName: "website_capture", status: "completed" as const, output: { taskId: "task-1" } };

    const view = render(<ToolBlockView block={block} />);
    let video = await screen.findByLabelText("网站浏览录屏");
    expect(video).toHaveAttribute("src", "/uploads/recording.webm");
    expect(video).toHaveAttribute("controls");
    view.unmount();
    render(<ToolBlockView block={block} />);
    video = await screen.findByLabelText("网站浏览录屏");
    expect(video).toHaveAttribute("src", "/uploads/recording.webm");
    expect(api.fetchWebsiteCaptureActions).not.toHaveBeenCalled();
  });

  it("offers a new approval request when the previous approval is unavailable", async () => {
    const task = { status: "queued", stage: "waiting_recording_approval", progress: 0 };
    api.fetchWebsiteCapture.mockResolvedValue({ task, events: [] });
    api.fetchWebsiteCaptureActions.mockResolvedValue([]);
    api.retryWebsiteCapture.mockResolvedValue({ task });
    const block = { type: "tool" as const, toolCallId: "capture-1", toolName: "website_capture", status: "completed" as const, output: { taskId: "task-1" } };
    render(<ToolBlockView block={block} />);
    fireEvent.click(await screen.findByRole("button", { name: "重新申请审批" }));
    await waitFor(() => expect(api.retryWebsiteCapture).toHaveBeenCalledWith("token", "task-1"));
  });
});
