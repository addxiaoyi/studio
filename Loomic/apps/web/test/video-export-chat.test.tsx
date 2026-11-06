// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolBlockView } from "@/components/chat/tool-block-view";

vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "test-token" } }) }));
vi.mock("@/lib/server-api", () => ({
  approveWebsiteCaptureAction: vi.fn(), cancelJob: vi.fn(), cancelWebsiteCapture: vi.fn(), exportJob: vi.fn(),
  fetchDesktopAgentTask: vi.fn(), fetchDesktopAgentTasks: vi.fn(), fetchJob: vi.fn(), fetchJobs: vi.fn(), fetchJobTimeline: vi.fn(),
  fetchWebsiteCapture: vi.fn(), fetchWebsiteCaptureActions: vi.fn(), prepareWebsitePromo: vi.fn(),
  rejectWebsiteCaptureAction: vi.fn(), retryWebsiteCapture: vi.fn(), resolveDesktopAgentApproval: vi.fn(), syncJob: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("video export chat delivery", () => {
  it("restores private playback after remount without another export", async () => {
    const fetchVideo = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }));
    const NativeURL = globalThis.URL;
    vi.stubGlobal("fetch", fetchVideo);
    vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL: vi.fn(() => "blob:export"), revokeObjectURL: vi.fn() }));
    const assetId = "123e4567-e89b-42d3-a456-426614174000";
    const block = { type: "tool" as const, toolCallId: "video-export-1", toolName: "video_export", status: "completed" as const, output: { assetId } };
    const first = render(<ToolBlockView block={block} />);
    expect(await screen.findByLabelText("视频成片")).toHaveAttribute("src", "blob:export");
    first.unmount();
    fetchVideo.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }));
    render(<ToolBlockView block={block} />);
    expect(await screen.findByLabelText("视频成片")).toHaveAttribute("controls");
    expect(fetchVideo).toHaveBeenCalledTimes(2);
    expect(fetchVideo).toHaveBeenLastCalledWith(expect.stringContaining(`/api/uploads/${assetId}/file`), expect.objectContaining({ headers: { Authorization: "Bearer test-token" }, redirect: "error" }));
  });
});
