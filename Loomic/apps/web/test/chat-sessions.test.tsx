// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createSessionMock, deleteSessionMock, fetchMessagesMock, fetchSessionsMock, updateSessionTitleMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  fetchMessagesMock: vi.fn(),
  fetchSessionsMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
}));

vi.mock("../src/lib/server-api", () => ({
  createSession: createSessionMock,
  deleteSession: deleteSessionMock,
  fetchMessages: fetchMessagesMock,
  fetchSessions: fetchSessionsMock,
  updateSessionTitle: updateSessionTitleMock,
}));

import { useChatSessions } from "../src/hooks/use-chat-sessions";

function SessionHarness() {
  const chat = useChatSessions({ canvasId: "canvas-1", accessToken: "token-1" });
  return (
    <div>
      <p data-testid="active-session">{chat.activeSessionId}</p>
      <p data-testid="messages">{chat.messages.map((message) => message.id).join(",")}</p>
      <p data-testid="error">{chat.messagesError ?? ""}</p>
      <button type="button" onClick={() => void chat.handleSelectSession("session-a")}>Select A</button>
      <button type="button" onClick={() => void chat.handleSelectSession("session-b")}>Select B</button>
    </div>
  );
}

describe("useChatSessions request recovery", () => {
  beforeEach(() => {
    fetchSessionsMock.mockReset();
    fetchMessagesMock.mockReset();
    createSessionMock.mockReset();
    deleteSessionMock.mockReset();
    updateSessionTitleMock.mockReset();
    fetchSessionsMock.mockResolvedValue({ sessions: [{ id: "session-home", title: "Home", updatedAt: "2026-10-18T00:00:00.000Z" }] });
    fetchMessagesMock.mockResolvedValue({ messages: [] });
  });

  afterEach(() => cleanup());

  it("does not let a slow session response overwrite the most recently selected session", async () => {
    let resolveA!: (value: { messages: Array<{ id: string; role: "assistant"; content: string; createdAt: string }> }) => void;
    const slowA = new Promise<{ messages: Array<{ id: string; role: "assistant"; content: string; createdAt: string }> }>((resolve) => { resolveA = resolve; });
    fetchMessagesMock.mockImplementation((_token: string, sessionId: string) => {
      if (sessionId === "session-a") return slowA;
      if (sessionId === "session-b") return Promise.resolve({ messages: [{ id: "message-b", role: "assistant", content: "B", createdAt: "2026-10-18T00:00:00.000Z" }] });
      return Promise.resolve({ messages: [] });
    });

    render(<SessionHarness />);
    await waitFor(() => expect(screen.getByTestId("active-session")).toHaveTextContent("session-home"));
    await act(async () => { screen.getByRole("button", { name: "Select A" }).click(); });
    await act(async () => { screen.getByRole("button", { name: "Select B" }).click(); });
    await waitFor(() => expect(screen.getByTestId("messages")).toHaveTextContent("message-b"));

    await act(async () => {
      resolveA({ messages: [{ id: "message-a", role: "assistant", content: "A", createdAt: "2026-10-18T00:00:00.000Z" }] });
      await slowA;
    });

    expect(screen.getByTestId("active-session")).toHaveTextContent("session-b");
    expect(screen.getByTestId("messages")).toHaveTextContent("message-b");
    expect(screen.getByTestId("messages")).not.toHaveTextContent("message-a");
  });

  it("reports a message fetch error instead of presenting an empty history", async () => {
    fetchMessagesMock.mockRejectedValueOnce(new Error("session history unavailable"));
    render(<SessionHarness />);

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("session history unavailable"));
  });
});
