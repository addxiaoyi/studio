// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockToken = "session-token";

import type { WebSocketHandle } from "../src/hooks/use-websocket";
import { ChatSidebar } from "../src/components/chat-sidebar";
import { TierLimitToastProvider } from "../src/components/credits/tier-limit-toast";
import { ToastProvider } from "../src/components/toast";

const {
  createSessionMock,
  deleteSessionMock,
  fetchMessagesMock,
  fetchSessionsMock,
  saveMessageMock,
  updateSessionTitleMock,
  fetchModelsMock,
  fetchImageModelsMock,
  fetchVideoModelsMock,
  fetchWorkspaceSkillsMock,
  createSkillMock,
  fetchBrandKitMock,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  fetchMessagesMock: vi.fn(),
  fetchSessionsMock: vi.fn(),
  saveMessageMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
  fetchModelsMock: vi.fn(),
  fetchImageModelsMock: vi.fn(),
  fetchVideoModelsMock: vi.fn(),
  fetchWorkspaceSkillsMock: vi.fn(),
  createSkillMock: vi.fn(),
  fetchBrandKitMock: vi.fn(),
}));

vi.mock("../src/lib/server-api", () => ({
  createSession: createSessionMock,
  deleteSession: deleteSessionMock,
  fetchMessages: fetchMessagesMock,
  fetchSessions: fetchSessionsMock,
  saveMessage: saveMessageMock,
  updateSessionTitle: updateSessionTitleMock,
  fetchModels: fetchModelsMock,
  fetchImageModels: fetchImageModelsMock,
  fetchVideoModels: fetchVideoModelsMock,
  fetchWorkspaceSkills: fetchWorkspaceSkillsMock,
  createSkill: createSkillMock,
}));

vi.mock("../src/lib/brand-kit-api", () => ({
  fetchBrandKit: fetchBrandKitMock,
}));

function createMockWs(): WebSocketHandle {
  return {
    connected: true,
    startRun: vi.fn((payload, onAck) => {
      // Simulate server ack
      onAck?.({
        type: "command.ack",
        action: "agent.run",
        payload: { runId: "run_123" },
      });
    }),
    cancelRun: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    registerRPC: vi.fn(() => () => {}),
    resumeCanvas: vi.fn(),
  };
}

describe("ChatSidebar", () => {
  let mockWs: WebSocketHandle;

  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });

    // Mock matchMedia for responsive hooks
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

    mockWs = createMockWs();

    // Reset all mocks
    [
      createSessionMock,
      deleteSessionMock,
      fetchMessagesMock,
      fetchSessionsMock,
      saveMessageMock,
      updateSessionTitleMock,
      fetchModelsMock,
      fetchImageModelsMock,
      fetchVideoModelsMock,
      fetchWorkspaceSkillsMock,
      createSkillMock,
      fetchBrandKitMock,
    ].forEach((m) => m.mockReset());

    // Default implementations for API mocks
    createSessionMock.mockResolvedValue({
      session: {
        id: "session-created",
        title: "New Chat",
        updatedAt: "2026-03-24T00:00:00.000Z",
      },
    });
    fetchMessagesMock.mockResolvedValue({ messages: [] });
    fetchSessionsMock.mockResolvedValue({
      sessions: [
        {
          id: "session-real",
          title: "Existing Chat",
          updatedAt: "2026-03-24T00:00:00.000Z",
        },
      ],
    });
    fetchModelsMock.mockResolvedValue({ models: [] });
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

  it("renders without crashing", async () => {
    render(
      <ToastProvider>
        <TierLimitToastProvider>
          <ChatSidebar
            accessToken={mockToken}
            canvasId="canvas-1"
            open
            onToggle={() => {}}
            ws={mockWs}
          />
        </TierLimitToastProvider>
      </ToastProvider>,
    );

    // Basic render check - input should be available
    const input = await screen.findByPlaceholderText(/start with an idea/i);
    expect(input).toBeInTheDocument();
  });
});