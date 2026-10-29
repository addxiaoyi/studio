// @vitest-environment jsdom
/**
 * P0-U2 — the auto-send effect for the goal typed on the home screen.
 *
 * It used to `return` silently whenever `ws.connected` was false: the goal stayed in
 * React state but the URL copy had already been deleted, so the user's target vanished.
 * Now a disconnected socket parks the goal visibly ("目标已暂存"), sends exactly once
 * after the socket comes back, and keeps the goal recoverable when the send throws.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "session-token" }, user: { id: "user-1" }, loading: false, sessionError: null }),
}));

const PROMPT = "介绍这个网站的主要功能";

const {
  createSessionMock,
  fetchMessagesMock,
  fetchSessionsMock,
  saveMessageMock,
  updateSessionTitleMock,
  fetchModelsMock,
  fetchWorkspaceSettingsMock,
  fetchImageModelsMock,
  fetchVideoModelsMock,
  fetchWorkspaceSkillsMock,
  fetchBrandKitMock,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  fetchMessagesMock: vi.fn(),
  fetchSessionsMock: vi.fn(),
  saveMessageMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
  fetchModelsMock: vi.fn(),
  fetchWorkspaceSettingsMock: vi.fn(),
  fetchImageModelsMock: vi.fn(),
  fetchVideoModelsMock: vi.fn(),
  fetchWorkspaceSkillsMock: vi.fn(),
  fetchBrandKitMock: vi.fn(),
}));

vi.mock("../src/lib/server-api", () => ({
  createSession: createSessionMock,
  deleteSession: vi.fn(),
  fetchMessages: fetchMessagesMock,
  fetchSessions: fetchSessionsMock,
  saveMessage: saveMessageMock,
  updateSessionTitle: updateSessionTitleMock,
  fetchModels: fetchModelsMock,
  fetchWorkspaceSettings: fetchWorkspaceSettingsMock,
  fetchImageModels: fetchImageModelsMock,
  fetchVideoModels: fetchVideoModelsMock,
  fetchWorkspaceSkills: fetchWorkspaceSkillsMock,
  createSkill: vi.fn(),
  fetchJob: vi.fn(),
  fetchLatestGenerationApproval: vi.fn().mockResolvedValue(null),
  fetchPendingGenerationApproval: vi.fn().mockResolvedValue(null),
  confirmLatestGenerationApproval: vi.fn(),
  generateVideoDirect: vi.fn(),
}));

vi.mock("../src/lib/brand-kit-api", () => ({ fetchBrandKit: fetchBrandKitMock }));

import type { WebSocketHandle } from "../src/hooks/use-websocket";
import { ChatSidebar } from "../src/components/chat-sidebar";
import { TierLimitToastProvider } from "../src/components/credits/tier-limit-toast";
import { ToastProvider } from "../src/components/toast";

function createWs(connected: boolean) {
  const ws = {
    connected,
    startRun: vi.fn((_payload: unknown, onAck?: (ack: unknown) => void) => {
      onAck?.({ type: "command.ack", action: "agent.run", payload: { runId: "run_1" } });
    }),
    cancelRun: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    registerRPC: vi.fn(() => () => {}),
    resumeCanvas: vi.fn(),
  };
  return ws as unknown as WebSocketHandle & { startRun: ReturnType<typeof vi.fn>; connected: boolean };
}

function renderSidebar(ws: WebSocketHandle, onInitialPromptHandoff?: (outcome: "sent" | "dismissed") => void) {
  return render(
    <ToastProvider>
      <TierLimitToastProvider>
        <ChatSidebar
          accessToken="session-token"
          canvasId="canvas-1"
          open
          onToggle={() => {}}
          ws={ws}
          initialPrompt={PROMPT}
          {...(onInitialPromptHandoff ? { onInitialPromptHandoff } : {})}
        />
      </TierLimitToastProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
    writable: true,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  [
    createSessionMock, fetchMessagesMock, fetchSessionsMock, saveMessageMock,
    updateSessionTitleMock, fetchModelsMock, fetchWorkspaceSettingsMock,
    fetchImageModelsMock, fetchVideoModelsMock, fetchWorkspaceSkillsMock, fetchBrandKitMock,
  ].forEach((m) => m.mockReset());

  createSessionMock.mockResolvedValue({ session: { id: "session-created", title: "New Chat", updatedAt: "2026-03-24T00:00:00.000Z" } });
  fetchMessagesMock.mockResolvedValue({ messages: [] });
  fetchSessionsMock.mockResolvedValue({ sessions: [{ id: "session-real", title: "Existing Chat", updatedAt: "2026-03-24T00:00:00.000Z" }] });
  saveMessageMock.mockResolvedValue({ message: { id: "message-1" } });
  updateSessionTitleMock.mockResolvedValue({ session: { id: "session-real", title: "Existing Chat", updatedAt: "2026-03-24T00:00:00.000Z" } });
  fetchModelsMock.mockResolvedValue({ models: [] });
  fetchWorkspaceSettingsMock.mockResolvedValue({ settings: { defaultModel: "openai:auto", chatModel: "openai:auto" } });
  fetchImageModelsMock.mockResolvedValue({ models: [] });
  fetchVideoModelsMock.mockResolvedValue({ models: [] });
  fetchWorkspaceSkillsMock.mockResolvedValue({ skills: [] });
  fetchBrandKitMock.mockResolvedValue({ assets: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("ChatSidebar initial prompt delivery", () => {
  it("parks the goal visibly instead of dropping it while the socket is down", async () => {
    const ws = createWs(false);
    renderSidebar(ws);

    expect(await screen.findByText("正在连接工作区，目标已暂存；连接成功后自动发送。")).toBeTruthy();
    expect(ws.startRun).not.toHaveBeenCalled();
    expect(saveMessageMock).not.toHaveBeenCalled();
  });

  it("sends the parked goal exactly once after the socket connects", async () => {
    const ws = createWs(false);
    const { rerender } = renderSidebar(ws);
    await screen.findByText("正在连接工作区，目标已暂存；连接成功后自动发送。");

    ws.connected = true;
    rerender(
      <ToastProvider>
        <TierLimitToastProvider>
          <ChatSidebar accessToken="session-token" canvasId="canvas-1" open onToggle={() => {}} ws={ws} initialPrompt={PROMPT} />
        </TierLimitToastProvider>
      </ToastProvider>,
    );

    await waitFor(() => expect(ws.startRun).toHaveBeenCalledTimes(1));
    const payload = ws.startRun.mock.calls[0]?.[0] as { prompt?: string };
    expect(payload.prompt).toBe(PROMPT);

    // Repeated renders (message list updates, streaming flags) must not resend.
    rerender(
      <ToastProvider>
        <TierLimitToastProvider>
          <ChatSidebar accessToken="session-token" canvasId="canvas-1" open onToggle={() => {}} ws={ws} initialPrompt={PROMPT} />
        </TierLimitToastProvider>
      </ToastProvider>,
    );
    rerender(
      <ToastProvider>
        <TierLimitToastProvider>
          <ChatSidebar accessToken="session-token" canvasId="canvas-1" open onToggle={() => {}} ws={ws} initialPrompt={PROMPT} />
        </TierLimitToastProvider>
      </ToastProvider>,
    );
    expect(ws.startRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("正在连接工作区，目标已暂存；连接成功后自动发送。")).toBeNull();
  });

  it("keeps the goal recoverable and offers a retry when the send throws", async () => {
    const user = userEvent.setup();
    const ws = createWs(true);
    const handoff = vi.fn();
    saveMessageMock.mockImplementationOnce(() => {
      throw new Error("network down");
    });

    renderSidebar(ws, handoff);
    expect(await screen.findByText("目标发送失败，已为你保留，可以重试。")).toBeTruthy();
    expect(ws.startRun).not.toHaveBeenCalled();
    expect(handoff).not.toHaveBeenCalledWith("sent");

    await user.click(await screen.findByRole("button", { name: "重试发送" }));

    await waitFor(() => expect(ws.startRun).toHaveBeenCalledTimes(1));
    const payload = ws.startRun.mock.calls[0]?.[0] as { prompt?: string };
    expect(payload.prompt).toBe(PROMPT);
    await waitFor(() => expect(handoff).toHaveBeenCalledWith("sent"));
    expect(screen.queryByText("目标发送失败，已为你保留，可以重试。")).toBeNull();
  });

  it("lets the user dismiss the parked goal explicitly without ever sending it", async () => {
    const user = userEvent.setup();
    const ws = createWs(false);
    const handoff = vi.fn();
    renderSidebar(ws, handoff);
    await screen.findByText("正在连接工作区，目标已暂存；连接成功后自动发送。");

    await user.click(screen.getByRole("button", { name: "放弃目标" }));

    expect(handoff).toHaveBeenCalledWith("dismissed");
    expect(screen.queryByText("正在连接工作区，目标已暂存；连接成功后自动发送。")).toBeNull();
    expect(ws.startRun).not.toHaveBeenCalled();
  });
});
