import { describe, expect, it, vi } from "vitest";
import {
  AGENT_FOCUS_CHANNEL,
  AGENT_FOCUS_SHORTCUT,
  registerAgentFocusShortcut,
  releaseAgentFocusShortcuts,
} from "./global-shortcut.js";

function makePort(registerResult: boolean | Error = true) {
  const trigger = { current: null as null | (() => void) };
  const register = vi.fn((accelerator: string, callback: () => void) => {
    if (registerResult instanceof Error) throw registerResult;
    if (registerResult) trigger.current = callback;
    return registerResult;
  });
  const unregisterAll = vi.fn();
  return { port: { register, unregisterAll }, register, unregisterAll, trigger };
}

describe("agent focus global shortcut", () => {
  it("keeps the hotkey centralised as Ctrl+Shift+Space on every platform", () => {
    expect(AGENT_FOCUS_SHORTCUT).toBe("CommandOrControl+Shift+Space");
    expect(AGENT_FOCUS_CHANNEL).toBe("desktop:focus-agent-input");
  });

  it("registers the configured accelerator once and routes its trigger", () => {
    const { port, register, trigger } = makePort();
    const onTrigger = vi.fn();
    const log = vi.fn();

    expect(registerAgentFocusShortcut(port, { onTrigger, log })).toBe(true);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(AGENT_FOCUS_SHORTCUT, expect.any(Function));
    expect(log).not.toHaveBeenCalled();

    trigger.current?.();
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("logs instead of throwing when another application already owns the hotkey", () => {
    const { port, trigger } = makePort(false);
    const onTrigger = vi.fn();
    const log = vi.fn();

    expect(() => registerAgentFocusShortcut(port, { onTrigger, log })).not.toThrow();
    expect(registerAgentFocusShortcut(port, { onTrigger, log })).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("already registered by another application"));
    expect(onTrigger).not.toHaveBeenCalled();
    expect(trigger.current).toBeNull();
  });

  it("swallows a registration error and reports the failure", () => {
    const failure = new Error("global shortcut unavailable");
    const { port } = makePort(failure);
    const log = vi.fn();

    expect(() => registerAgentFocusShortcut(port, { onTrigger: vi.fn(), log })).not.toThrow();
    expect(registerAgentFocusShortcut(port, { onTrigger: vi.fn(), log })).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Failed to register"), failure);
  });

  it("releases every accelerator on shutdown", () => {
    const { port, unregisterAll } = makePort();
    const log = vi.fn();

    releaseAgentFocusShortcuts(port, { log });
    expect(unregisterAll).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("never throws when shutdown teardown fails", () => {
    const failure = new Error("already destroyed");
    const unregisterAll = vi.fn(() => {
      throw failure;
    });
    const log = vi.fn();

    expect(() => releaseAgentFocusShortcuts({ register: vi.fn(), unregisterAll }, { log })).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Failed to unregister"), failure);
  });
});
