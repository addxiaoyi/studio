type SenderEvent = { sender: unknown };

type DesktopWindow = {
  isDestroyed(): boolean;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  setFullScreen(fullScreen: boolean): void;
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  close(): void;
  hide(): void;
  on(event: string, listener: (event?: { preventDefault(): void }) => void): void;
  off(event: string, listener: (event?: { preventDefault(): void }) => void): void;
  webContents: {
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    on(event: string, listener: () => void): void;
    off(event: string, listener: () => void): void;
    send(channel: string, state: unknown): void;
  };
};

type IpcMainPort = {
  handle(
    channel: string,
    listener: (event: SenderEvent, ...args: unknown[]) => unknown,
  ): void;
};

type WindowControlOptions = {
  getMainWindow(): DesktopWindow | null;
  resolveWindow(sender: unknown): DesktopWindow | null;
  platform: NodeJS.Platform;
};

type NavigationState = { canGoBack: boolean; canGoForward: boolean };

type FullScreenState = { isFullScreen: boolean };

function fullScreenState(window: DesktopWindow): FullScreenState {
  return { isFullScreen: window.isFullScreen() };
}

function requireMainWindow(
  event: SenderEvent,
  options: WindowControlOptions,
): DesktopWindow {
  const window = options.resolveWindow(event.sender);
  if (!window || window !== options.getMainWindow() || window.isDestroyed()) {
    throw new Error("This action is only available in the Helstera main window.");
  }
  return window;
}

function navigationState(window: DesktopWindow): NavigationState {
  return {
    canGoBack: window.webContents.canGoBack(),
    canGoForward: window.webContents.canGoForward(),
  };
}

export function registerWindowControlHandlers(
  ipc: IpcMainPort,
  options: WindowControlOptions,
): void {
  ipc.handle("window-state", (event) => {
    const window = requireMainWindow(event, options);
    return { isMaximized: window.isMaximized() };
  });
  ipc.handle("window-minimize", (event) => {
    requireMainWindow(event, options).minimize();
  });
  ipc.handle("window-maximize", (event) => {
    const window = requireMainWindow(event, options);
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return { isMaximized: window.isMaximized() };
  });
  ipc.handle("window-fullscreen", (event) => {
    const window = requireMainWindow(event, options);
    if (window.isFullScreen()) window.setFullScreen(false);
    else window.setFullScreen(true);
    return fullScreenState(window);
  });
  ipc.handle("desktop.fullscreen-state", (event) =>
    fullScreenState(requireMainWindow(event, options)),
  );
  ipc.handle("window-close", (event) => {
    const window = requireMainWindow(event, options);
    if (options.platform === "darwin") window.hide();
    else window.close();
  });
  ipc.handle("desktop.navigation-state", (event) =>
    navigationState(requireMainWindow(event, options)),
  );
  ipc.handle("desktop.navigate-history", (event, direction) => {
    const window = requireMainWindow(event, options);
    if (direction === "back" && window.webContents.canGoBack()) {
      window.webContents.goBack();
    } else if (
      direction === "forward" &&
      window.webContents.canGoForward()
    ) {
      window.webContents.goForward();
    } else if (direction !== "back" && direction !== "forward") {
      throw new Error("Navigation direction must be back or forward.");
    }
    return navigationState(window);
  });
}

export function observeWindowState(window: DesktopWindow): () => void {
  const publishWindowState = () => {
    if (!window.isDestroyed()) {
      window.webContents.send("window-state-changed", {
        isMaximized: window.isMaximized(),
      });
    }
  };
  const publishNavigationState = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(
        "desktop:navigation-state",
        navigationState(window),
      );
    }
  };
  const publishFullScreenState = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(
        "desktop:fullscreen-changed",
        fullScreenState(window),
      );
    }
  };
  const windowEvents = ["maximize", "unmaximize", "restore"];
  const fullScreenEvents = ["enter-full-screen", "leave-full-screen"];
  const navigationEvents = [
    "did-navigate",
    "did-navigate-in-page",
    "did-finish-load",
  ];

  for (const event of windowEvents) window.on(event, publishWindowState);
  for (const event of fullScreenEvents) window.on(event, publishFullScreenState);
  for (const event of navigationEvents)
    window.webContents.on(event, publishNavigationState);

  return () => {
    for (const event of windowEvents) window.off(event, publishWindowState);
    for (const event of fullScreenEvents)
      window.off(event, publishFullScreenState);
    for (const event of navigationEvents)
      window.webContents.off(event, publishNavigationState);
  };
}

/**
 * 主窗口内发生整页跳转（will-navigate）时的处置：
 * 同源页面留在应用内，外部 http(s) 一律交给系统浏览器，其余协议直接拦截。
 */
export function decideMainWindowNavigation(
  rawUrl: string,
  appOrigin: string,
): NavigationDecision {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return "deny";
  }
  if (target.origin === appOrigin) return "allow";
  return target.protocol === "https:" || target.protocol === "http:"
    ? "external"
    : "deny";
}

type NavigationDecision = "allow" | "external" | "deny";

export function observeMainWindowLifecycle(
  window: DesktopWindow,
  platform: NodeJS.Platform,
  onClosed: () => void,
): void {
  const stopObserving = observeWindowState(window);
  window.on("close", (event) => {
    if (platform === "darwin") {
      event?.preventDefault();
      if (!window.isDestroyed()) window.hide();
      return;
    }
    stopObserving();
  });
  window.on("closed", onClosed);
}
