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
  it("renders a saved video export using authenticated asset access", async () => {
    const fetchVideo = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }));
    const NativeURL = globalThis.URL;
    vi.stubGlobal("fetch", fetchVideo);
    vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL: vi.fn(() => "blob:export"), revokeObjectURL: vi.fn() }));
    const assetId = "123e4567-e89b-42d3-a456-426614174000";
    render(<ToolBlockView block={{ type: "tool", toolCallId: "export-1", toolName: "video_export", status: "completed", output: { assetId } }} />);
    expect(await screen.findByLabelText("视频成片")).toHaveAttribute("src", "blob:export");
    expect(fetchVideo).toHaveBeenCalledWith(expect.stringContaining(`/api/uploads/${assetId}/file`), expect.objectContaining({ headers: { Authorization: "Bearer token" }, redirect: "error" }));
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
