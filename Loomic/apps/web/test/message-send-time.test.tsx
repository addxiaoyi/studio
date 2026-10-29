// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/canvas",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "session-token" } }),
}));

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  fetchMessages: vi.fn(),
  fetchSessions: vi.fn(),
  saveMessage: vi.fn(),
  updateSessionTitle: vi.fn(),
  fetchImageModels: vi.fn(),
  fetchVideoModels: vi.fn(),
  fetchWorkspaceSkills: vi.fn(),
  fetchJob: vi.fn(),
  fetchLatestGenerationApproval: vi.fn(),
  fetchPendingGenerationApproval: vi.fn(),
  confirmLatestGenerationApproval: vi.fn(),
  generateVideoDirect: vi.fn(),
  fetchModels: vi.fn(),
  fetchWorkspaceSettings: vi.fn(),
  createSkill: vi.fn(),
  fetchBrandKit: vi.fn(),
}));

vi.mock("../src/lib/server-api", () => ({
  createSession: mocks.createSession,
  deleteSession: mocks.deleteSession,
  fetchMessages: mocks.fetchMessages,
  fetchSessions: mocks.fetchSessions,
  saveMessage: mocks.saveMessage,
  updateSessionTitle: mocks.updateSessionTitle,
  fetchImageModels: mocks.fetchImageModels,
  fetchVideoModels: mocks.fetchVideoModels,
  fetchWorkspaceSkills: mocks.fetchWorkspaceSkills,
  fetchJob: mocks.fetchJob,
  fetchLatestGenerationApproval: mocks.fetchLatestGenerationApproval,
  fetchPendingGenerationApproval: mocks.fetchPendingGenerationApproval,
  confirmLatestGenerationApproval: mocks.confirmLatestGenerationApproval,
  generateVideoDirect: mocks.generateVideoDirect,
  fetchModels: mocks.fetchModels,
  fetchWorkspaceSettings: mocks.fetchWorkspaceSettings,
  createSkill: mocks.createSkill,
}));

vi.mock("../src/lib/brand-kit-api", () => ({
  fetchBrandKit: mocks.fetchBrandKit,
}));

import {
  ChatSidebar,
  formatMessageTime,
  nowIso,
} from "../src/components/chat-sidebar";
import { TierLimitToastProvider } from "../src/components/credits/tier-limit-toast";
import { ToastProvider } from "../src/components/toast";
import { mapServerMessages } from "../src/hooks/use-chat-sessions";
import type { WebSocketHandle } from "../src/hooks/use-websocket";

function createMockWs(): WebSocketHandle {
  return {
    connected: true,
    startRun: vi.fn(),
    cancelRun: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    registerRPC: vi.fn(() => () => {}),
    resumeCanvas: vi.fn(),
  };
}

/** Local wall-clock instant → ISO, so assertions hold in any timezone. */
function localIso(
  dayOffset: number,
  hours: number,
  minutes: number,
): string {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + dayOffset,
    hours,
    minutes,
    0,
    0,
  ).toISOString();
}

describe("message send time", () => {
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

    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.fetchSessions.mockResolvedValue({
      sessions: [
        { id: "session-real", title: "Existing Chat", updatedAt: localIso(0, 12, 0) },
      ],
    });
    mocks.fetchMessages.mockResolvedValue({ messages: [] });
    mocks.fetchImageModels.mockResolvedValue({ models: [] });
    mocks.fetchVideoModels.mockResolvedValue({ models: [] });
    mocks.fetchWorkspaceSkills.mockResolvedValue({ skills: [] });
    mocks.fetchBrandKit.mockResolvedValue({ assets: [] });
    mocks.fetchWorkspaceSettings.mockResolvedValue({
      settings: { defaultModel: "openai:auto", chatModel: "openai:auto" },
    });
    mocks.fetchModels.mockResolvedValue({ models: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("renders the send time next to a stored message bubble", async () => {
    const today = localIso(0, 14, 30);
    const yesterday = localIso(-1, 9, 5);
    mocks.fetchMessages.mockResolvedValue({
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "今天的问题",
          contentBlocks: [{ type: "text", text: "今天的问题" }],
          createdAt: today,
        },
        {
          id: "message-2",
          role: "assistant",
          content: "昨天的回答",
          contentBlocks: [{ type: "text", text: "昨天的回答" }],
          createdAt: yesterday,
        },
      ],
    });

    render(
      <ToastProvider>
        <TierLimitToastProvider>
          <ChatSidebar
            accessToken="session-token"
            canvasId="canvas-1"
            open
            onToggle={() => {}}
            initialSessionId="session-real"
            ws={createMockWs()}
          />
        </TierLimitToastProvider>
      </ToastProvider>,
    );

    // Same day → time only.
    const sameDay = await screen.findByText("14:30");
    expect(sameDay.tagName).toBe("TIME");
    expect(sameDay).toHaveAttribute("datetime", today);

    // Other day → date + time, so the two bubbles stay distinguishable.
    const otherDay = await screen.findByText(/^\d{2}-\d{2} 09:05$/);
    expect(otherDay.tagName).toBe("TIME");
    expect(otherDay).toHaveAttribute("datetime", yesterday);
  });

  it("keeps the timestamp through the server-message mapping", () => {
    const createdAt = localIso(0, 8, 15);
    const mapped = mapServerMessages([
      {
        id: "message-1",
        role: "user",
        content: "hello",
        contentBlocks: [{ type: "text", text: "hello" }],
        createdAt,
      },
    ] as never);

    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.createdAt).toBe(createdAt);
  });

  it("stamps locally created messages with a send time", () => {
    const before = Date.now();
    const stamp = nowIso();
    const after = Date.now();

    expect(Number.isNaN(new Date(stamp).getTime())).toBe(false);
    expect(new Date(stamp).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(stamp).getTime()).toBeLessThanOrEqual(after);
  });
});

describe("formatMessageTime", () => {
  const now = new Date(2026, 9, 29, 18, 30, 0, 0);

  it("shows only HH:mm for messages from the same local day", () => {
    expect(formatMessageTime(new Date(2026, 9, 29, 14, 30).toISOString(), now)).toBe("14:30");
    expect(formatMessageTime(new Date(2026, 9, 29, 0, 0).toISOString(), now)).toBe("00:00");
    expect(formatMessageTime(new Date(2026, 9, 29, 23, 59).toISOString(), now)).toBe("23:59");
  });

  it("adds the date when the message is from another day of the same year", () => {
    expect(formatMessageTime(new Date(2026, 9, 28, 9, 5).toISOString(), now)).toBe("10-28 09:05");
    expect(formatMessageTime(new Date(2026, 11, 31, 23, 59).toISOString(), now)).toBe("12-31 23:59");
  });

  it("adds the year when the message is older than the current year", () => {
    expect(formatMessageTime(new Date(2025, 11, 31, 23, 59).toISOString(), now)).toBe(
      "2025-12-31 23:59",
    );
  });

  it("returns an empty string instead of Invalid Date for unusable values", () => {
    expect(formatMessageTime(undefined, now)).toBe("");
    expect(formatMessageTime(null, now)).toBe("");
    expect(formatMessageTime("", now)).toBe("");
    expect(formatMessageTime("not-a-date", now)).toBe("");
  });
});
