import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  observeMainWindowLifecycle,
  observeWindowState,
  registerWindowControlHandlers,
} from "./window-controls.js";

function makeWindow() {
  const windowEvents = new EventEmitter();
  const webEvents = new EventEmitter();
  const windowListeners = new Map<string, Map<Function, Function>>();
  let maximized = false;
  let destroyed = false;
  const closeEvent = { preventDefault: vi.fn() };
  let canGoBack = true;
  let canGoForward = false;
  const window = {
    isDestroyed: vi.fn(() => destroyed),
    isMaximized: vi.fn(() => maximized),
    minimize: vi.fn(),
    maximize: vi.fn(() => { maximized = true; }),
    unmaximize: vi.fn(() => { maximized = false; }),
    close: vi.fn(),
    hide: vi.fn(),
    on: (event: string, listener: (event?: { preventDefault(): void }) => void) => {
      const wrapped = (...args: unknown[]) => listener(args[0] as { preventDefault(): void } | undefined);
      const listeners = windowListeners.get(event) ?? new Map<Function, Function>();
      listeners.set(listener, wrapped);
      windowListeners.set(event, listeners);
      windowEvents.on(event, wrapped);
    },
    off: (event: string, listener: (event?: { preventDefault(): void }) => void) => {
      const wrapped = windowListeners.get(event)?.get(listener);
      if (wrapped) windowEvents.off(event, wrapped as (...args: unknown[]) => void);
    },
    webContents: {
      canGoBack: vi.fn(() => canGoBack),
      canGoForward: vi.fn(() => canGoForward),
      goBack: vi.fn(() => { canGoBack = false; canGoForward = true; }),
      goForward: vi.fn(() => { canGoBack = true; canGoForward = false; }),
      on: webEvents.on.bind(webEvents),
      off: webEvents.off.bind(webEvents),
      send: vi.fn(),
    },
    events: { windowEvents, webEvents, closeEvent },
    destroy: () => { destroyed = true; },
  };
  return window;
}

function makeIpc(window = makeWindow(), platform: NodeJS.Platform = "win32") {
  const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
  const ipc = { handle: vi.fn((name, listener) => handlers.set(name, listener)) };
  registerWindowControlHandlers(ipc, {
    getMainWindow: () => window,
    resolveWindow: (sender) => sender === window.webContents ? window : null,
    platform,
  });
  const invoke = (name: string, ...args: unknown[]) => {
    const listener = handlers.get(name);
    if (!listener) throw new Error(`Missing handler: ${name}`);
    return listener({ sender: window.webContents }, ...args);
  };
  return { handlers, invoke, ipc, window };
}

describe("desktop window controls", () => {
  it("registers window commands and toggles maximize state", () => {
    const { handlers, invoke, window } = makeIpc();

    expect([...handlers.keys()]).toEqual([
      "window-state",
      "window-minimize",
      "window-maximize",
      "window-close",
      "desktop.navigation-state",
      "desktop.navigate-history",
    ]);
    expect(invoke("window-state")).toEqual({ isMaximized: false });
    expect(invoke("window-maximize")).toEqual({ isMaximized: true });
    expect(invoke("window-maximize")).toEqual({ isMaximized: false });
    expect(window.maximize).toHaveBeenCalledOnce();
    expect(window.unmaximize).toHaveBeenCalledOnce();
  });

  it("supports minimize, platform close behavior, and guarded history", () => {
    const windows = makeIpc();
    windows.invoke("window-minimize");
    windows.invoke("window-close");
    expect(windows.window.minimize).toHaveBeenCalledOnce();
    expect(windows.window.close).toHaveBeenCalledOnce();

    const mac = makeIpc(makeWindow(), "darwin");
    mac.invoke("window-close");
    expect(mac.window.hide).toHaveBeenCalledOnce();
    expect(mac.window.close).not.toHaveBeenCalled();

    expect(windows.invoke("desktop.navigation-state")).toEqual({
      canGoBack: true,
      canGoForward: false,
    });
    windows.invoke("desktop.navigate-history", "back");
    expect(windows.window.webContents.goBack).toHaveBeenCalledOnce();
    expect(() => windows.invoke("desktop.navigate-history", "sideways")).toThrow(
      "Navigation direction must be back or forward.",
    );
  });

  it("rejects window control calls from another renderer", () => {
    const { handlers, invoke } = makeIpc();
    const call = handlers.get("window-close");

    expect(() => call?.({ sender: {} })).toThrow(
      "This action is only available in the Helstera main window.",
    );
    expect(() => invoke("window-close")).not.toThrow();
  });

  it("publishes state changes and detaches event listeners", () => {
    const { window } = makeIpc();
    const detach = observeWindowState(window);

    window.events.windowEvents.emit("maximize");
    window.events.webEvents.emit("did-navigate");

    expect(window.webContents.send).toHaveBeenNthCalledWith(
      1,
      "window-state-changed",
      { isMaximized: false },
    );
    expect(window.webContents.send).toHaveBeenNthCalledWith(
      2,
      "desktop:navigation-state",
      { canGoBack: true, canGoForward: false },
    );
    detach();
    window.events.windowEvents.emit("maximize");
    expect(window.webContents.send).toHaveBeenCalledTimes(2);
  });

  it("detaches during close and ignores delayed events after destruction", () => {
    const { window } = makeIpc();
    const onClosed = vi.fn();
    observeMainWindowLifecycle(window, "win32", onClosed);

    window.events.windowEvents.emit("close", window.events.closeEvent);
    window.destroy();
    window.events.windowEvents.emit("closed");
    window.events.webEvents.emit("did-navigate");
    window.events.windowEvents.emit("maximize");

    expect(window.webContents.send).not.toHaveBeenCalled();
    expect(window.isDestroyed()).toBe(true);
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("keeps macOS close behavior as hide instead of destroy", () => {
    const { window } = makeIpc(makeWindow(), "darwin");
    observeMainWindowLifecycle(window, "darwin", vi.fn());

    window.events.windowEvents.emit("close", window.events.closeEvent);

    expect(window.events.closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();
    expect(window.webContents.send).not.toHaveBeenCalled();
  });
});
