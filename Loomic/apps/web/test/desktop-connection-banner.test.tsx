// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopConnectionBanner } from "@/components/desktop-connection-banner";
import {
  publishRealtimeStatus,
  resetRealtimeStatusForTests,
} from "@/lib/realtime-status";

beforeEach(() => {
  resetRealtimeStatusForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DesktopConnectionBanner", () => {
  it("stays quiet during the very first connect", () => {
    render(<DesktopConnectionBanner />);
    expect(document.querySelector(".desktop-connection-banner")).toBeNull();
  });

  it("appears once a live connection drops, then confirms recovery and hides", async () => {
    vi.useFakeTimers();
    render(<DesktopConnectionBanner />);

    act(() => { publishRealtimeStatus("connected"); });
    expect(document.querySelector(".desktop-connection-banner")).toBeNull();

    act(() => { publishRealtimeStatus("disconnected"); });
    expect(screen.getByText("连接已断开，正在重新连接…")).toBeTruthy();

    act(() => { publishRealtimeStatus("connected"); });
    expect(screen.getByText("连接已恢复")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(2100); });
    expect(document.querySelector(".desktop-connection-banner")).toBeNull();
  });

  it("warns immediately when the browser reports being offline", () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<DesktopConnectionBanner />);
    expect(screen.getByText("网络不可用，请检查网络连接")).toBeTruthy();
    spy.mockRestore();
  });

  it("uses english copy for the en-US locale", () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<DesktopConnectionBanner locale="en-US" />);
    expect(screen.getByText("You are offline — check your network")).toBeTruthy();
    spy.mockRestore();
  });
});
