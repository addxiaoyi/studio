type SenderEvent = { sender: unknown };

type DesktopWindow = {
  isDestroyed(): boolean;
  isMaximized(): boolean;
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
  const windowEvents = ["maximize", "unmaximize", "restore"];
  const navigationEvents = [
    "did-navigate",
    "did-navigate-in-page",
    "did-finish-load",
  ];

  for (const event of windowEvents) window.on(event, publishWindowState);
  for (const event of navigationEvents)
    window.webContents.on(event, publishNavigationState);

  return () => {
    for (const event of windowEvents) window.off(event, publishWindowState);
    for (const event of navigationEvents)
      window.webContents.off(event, publishNavigationState);
  };
}

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
