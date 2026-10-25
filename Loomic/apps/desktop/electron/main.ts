import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { join } from "path";
import {
  type DesktopAgentAction,
  type DesktopAgentTask,
  classifyDesktopAction,
  desktopAgentActionSchema,
  desktopAgentTaskSchema,
  desktopMcpToolCallSchema,
  desktopMcpToolCatalogSchema,
} from "@helstera/shared";
import { buildBrowserPairingUrl } from "./browser-pairing.js";
import {
  clickNativeText,
  clickNativeCoordinates,
  clickGroundedTarget,
  groundNativeTarget,
  pressNativeKey,
  scrollNativeWindow,
  dragNativeMouse,
  waitForNativeText,
  listNativeWindows,
  focusNativeWindowByTitle,
  readNativeClipboard,
  writeNativeClipboard,
  pasteNativeClipboard,
  launchApplication,
  closeApplicationByPid,
  inspectNativeDesktop,
  typeIntoNativeControl,
} from "./native-automation.js";
import {
  DesktopLoginCallbackQueue,
  type DesktopLoginCallback,
} from "./desktop-login.js";
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  safeStorage,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import { LocalWorkspace } from "./local-workspace.js";
import { McpRegistry, type McpServerInput } from "./mcp-registry.js";
import {
  observeMainWindowLifecycle,
  registerWindowControlHandlers,
} from "./window-controls.js";

let mainWindow: BrowserWindow | null = null;
let mainWindowReady = false;
let tray: Tray | null = null;
let embeddedBrowserWindow: BrowserWindow | null = null;
let recorderWindow: BrowserWindow | null = null;
let assistantSocket: any = null;
let assistantSessionToken = "";
let assistantConnectionId = "";
const desktopTaskTabs = new Map<string, BrowserWindow | null>();
const desktopAgentTasks = new Map<string, DesktopAgentTask>();
const desktopAgentPlans = new Map<string, DesktopAgentAction[]>();
const desktopAgentRounds = new Map<string, number>();
const MAX_NATIVE_AGENT_ROUNDS = 5;
const nativeTaskRecordings = new Map<string, NativeScreenRecording>();
const pendingVisionCoordinates = new Map<
  string,
  {
    resolve: (value: { found: boolean; x: number; y: number; confidence: number }) => void;
    reject: (error: Error) => void;
  }
>();
type UpdateState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "not-available"
    | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
};
type UpdateStateInput = Omit<UpdateState, "currentVersion">;
let updateState: UpdateState = {
  status: "idle",
  currentVersion: app.getVersion(),
};
let updateCheckActive = false;
let updateTimer: ReturnType<typeof setInterval> | null = null;
const PRODUCTION_WEBSITE_URL = "https://studio.0st.top/";
const DESKTOP_AUTH_SCHEME = "helstera:";
const DESKTOP_LOGIN_TTL_MS = 5 * 60 * 1000;
const pendingDesktopLogins = new Map<string, number>();
const desktopLoginTimers = new Map<string, ReturnType<typeof setTimeout>>();
const desktopLoginCallbacks = new DesktopLoginCallbackQueue();
let desktopLoginStatus:
  | "waiting"
  | "exchanging"
  | "completed"
  | "failed"
  | "canceled"
  | "expired" = "failed";
let desktopCallbackServer: Server | null = null;
let desktopCallbackUrl = "";
let localWorkspace: LocalWorkspace | null = null;
let localWorkspaceSessionId = "";
const workspaceRuns = new Map<string, AbortController>();
let mcpRegistry: McpRegistry | null = null;
const desktopMcpCalls = new Map<string, AbortController>();

registerWindowControlHandlers(ipcMain, {
  getMainWindow: () => mainWindow,
  resolveWindow: (sender) =>
    BrowserWindow.fromWebContents(sender as Electron.WebContents),
  platform: process.platform,
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  void receiveDesktopLoginUrl(url).then(focusMainWindow);
});

app.on("second-instance", (_event, commandLine) => {
  const authUrl = commandLine.find((argument) =>
    argument.startsWith(`${DESKTOP_AUTH_SCHEME}//`),
  );
  if (authUrl) void receiveDesktopLoginUrl(authUrl).then(focusMainWindow);
  else focusMainWindow();
});

function requireMainWindow(event: Electron.IpcMainInvokeEvent) {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!sender || sender !== mainWindow || sender.isDestroyed())
    throw new Error(
      "This action is only available in the Helstera main window.",
    );
  return sender;
}

function requireLocalWorkspace(event: Electron.IpcMainInvokeEvent) {
  requireMainWindow(event);
  if (!localWorkspace) throw new Error("Select a local project folder first.");
  return localWorkspace;
}

function requireMcpRegistry(event: Electron.IpcMainInvokeEvent) {
  requireMainWindow(event);
  if (!mcpRegistry) throw new Error("MCP registry is not ready yet.");
  return mcpRegistry;
}

function desktopWebsiteUrl() {
  if (app.isPackaged) {
    const localPreviewUrl = process.env.HELSTERA_DESKTOP_LOCAL_URL?.trim();
    if (!localPreviewUrl) return PRODUCTION_WEBSITE_URL;
    const preview = new URL(localPreviewUrl);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      preview.hostname,
    );
    if (preview.protocol !== "http:" || !isLoopback) {
      throw new Error(
        "HELSTERA_DESKTOP_LOCAL_URL only allows an HTTP loopback URL.",
      );
    }
    return preview.toString();
  }
  return process.env.HELSTERA_DESKTOP_URL?.trim() || PRODUCTION_WEBSITE_URL;
}

function publishDesktopLoginState(
  status:
    | "waiting"
    | "exchanging"
    | "completed"
    | "failed"
    | "canceled"
    | "expired",
) {
  desktopLoginStatus = status;
  if (!mainWindow?.isDestroyed())
    mainWindow?.webContents.send("desktop:login-state", { status });
}

function clearPendingDesktopLogin(state: string) {
  pendingDesktopLogins.delete(state);
  desktopLoginCallbacks.discard(state);
  const timer = desktopLoginTimers.get(state);
  if (timer) clearTimeout(timer);
  desktopLoginTimers.delete(state);
}

async function ensureDesktopCallbackServer(): Promise<string> {
  if (desktopCallbackServer && desktopCallbackUrl) return desktopCallbackUrl;
  const server = createServer((request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405, {
        allow: "GET",
        "cache-control": "no-store",
      }).end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      response.writeHead(404).end();
      return;
    }
    const token = url.searchParams.get("desktop_token") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const callbackUrl = `helstera://auth/callback?desktop_token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`;
    void receiveDesktopLoginUrl(callbackUrl).then((accepted) => {
      response.writeHead(accepted ? 200 : 503, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
      });
      response.end(accepted
        ? "<!doctype html><meta charset=utf-8><title>Helstera Desktop</title><h1>登录已交给 Helstera Desktop</h1><p>可以关闭此页面。</p>"
        : "<!doctype html><meta charset=utf-8><title>Helstera Desktop</title><h1>桌面暂未确认登录</h1><p>请返回桌面重试，登录请求仍然有效。</p>");
    }).catch((error) => {
      console.error("[desktop-auth] Loopback callback failed:", error);
      if (!response.headersSent) response.writeHead(503, { "cache-control": "no-store" }).end();
      else response.destroy();
    }).finally(() => {
      const callback = desktopLoginCallbacks.pending().find((item) => item.state === state);
      if (!callback) {
      server.close();
      if (desktopCallbackServer === server) desktopCallbackServer = null;
      desktopCallbackUrl = "";
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("无法启动桌面登录回调服务。");
  }
  desktopCallbackServer = server;
  desktopCallbackUrl = `http://127.0.0.1:${address.port}/callback`;
  return desktopCallbackUrl;
}

async function deliverDesktopLoginCallback(callback: DesktopLoginCallback) {
  const window = mainWindow;
  if (!window || window.isDestroyed() || !mainWindowReady) {
    throw new Error("The Helstera Desktop window is not ready.");
  }

  const callbackPage = new URL("/auth/callback/", desktopWebsiteUrl());
  callbackPage.searchParams.set("desktop_token", callback.token);
  callbackPage.searchParams.set("state", callback.state);
  publishDesktopLoginState("exchanging");
  await window.loadURL(callbackPage.toString());
  if (window.isDestroyed() || mainWindow !== window) {
    throw new Error("The Helstera Desktop window closed during login handoff.");
  }

  clearPendingDesktopLogin(callback.state);
  window.show();
  window.focus();
}

async function receiveDesktopLoginUrl(value: string): Promise<boolean> {
  const callback = desktopLoginCallbacks.enqueue(value, pendingDesktopLogins);
  if (!callback) return false;

  const delivered = await desktopLoginCallbacks.deliver(
    callback.state,
    deliverDesktopLoginCallback,
  );
  if (!delivered && mainWindow && !mainWindow.isDestroyed()) {
    publishDesktopLoginState("failed");
    console.error("[desktop-auth] Callback navigation failed; callback remains retryable.");
  }
  return delivered;
}

async function deliverPendingDesktopLoginCallbacks() {
  for (const callback of desktopLoginCallbacks.pending()) {
    const value = `helstera://auth/callback?desktop_token=${encodeURIComponent(callback.token)}&state=${encodeURIComponent(callback.state)}`;
    await receiveDesktopLoginUrl(value);
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function publishUpdateState(next: UpdateStateInput) {
  updateState = { ...next, currentVersion: app.getVersion() };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed())
      window.webContents.send("desktop:update-state", updateState);
  }
}

function updateFeedUrl() {
  const platform =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "macos"
        : "linux";
  const architecture = process.arch === "arm64" ? "arm64" : "x64";
  return `https://studio.0st.top/downloads/updates/${platform}-${architecture}/`;
}

async function checkForDesktopUpdate() {
  if (!app.isPackaged || updateCheckActive) return updateState;
  updateCheckActive = true;
  publishUpdateState({ status: "checking" });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publishUpdateState({
      status: "error",
      message: error instanceof Error ? error.message : "更新检查失败",
    });
  } finally {
    updateCheckActive = false;
  }
  return updateState;
}

function configureAutoUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL({ provider: "generic", url: updateFeedUrl() });
  autoUpdater.on("checking-for-update", () =>
    publishUpdateState({ status: "checking" }),
  );
  autoUpdater.on("update-available", (info) =>
    publishUpdateState({
      status: "available",
      version: info.version,
      message: "发现新版本，正在后台下载",
    }),
  );
  autoUpdater.on("download-progress", (progress) =>
    publishUpdateState({
      status: "downloading",
      percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      ...(updateState.version ? { version: updateState.version } : {}),
      message: "正在下载更新",
    }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    publishUpdateState({
      status: "downloaded",
      version: info.version,
      message: "更新已下载，重启后安装",
    }),
  );
  autoUpdater.on("update-not-available", () =>
    publishUpdateState({
      status: "not-available",
      message: "当前已是最新版本",
    }),
  );
  autoUpdater.on("error", (error) =>
    publishUpdateState({
      status: "error",
      message: error.message.slice(0, 240),
    }),
  );
  setTimeout(() => void checkForDesktopUpdate(), 8_000);
  updateTimer = setInterval(
    () => void checkForDesktopUpdate(),
    6 * 60 * 60 * 1000,
  );
}

ipcMain.handle("desktop.update-state", () => updateState);
ipcMain.handle("desktop.check-updates", () => checkForDesktopUpdate());
ipcMain.handle("app-version", () => app.getVersion());
ipcMain.handle("desktop.install-update", () => {
  if (updateState.status !== "downloaded") return { ok: false };
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

ipcMain.handle("desktop.open-browser-pairing", async (event, input: unknown) => {
  requireMainWindow(event);
  const url = buildBrowserPairingUrl(input, desktopWebsiteUrl());
  await shell.openExternal(url);
  return { ok: true, url };
});

ipcMain.handle("desktop.browser-login-available", (event) => {
  requireMainWindow(event);
  return app.isPackaged;
});
ipcMain.handle("desktop.browser-login-status", (event) => {
  requireMainWindow(event);
  return { status: desktopLoginStatus };
});
ipcMain.handle("desktop.start-browser-login", async (event) => {
  requireMainWindow(event);
  if (!app.isPackaged)
    return { ok: false, message: "请在正式桌面版中使用浏览器登录。" };
  app.setAsDefaultProtocolClient("helstera");
  for (const [state, expiresAt] of pendingDesktopLogins)
    if (expiresAt <= Date.now()) clearPendingDesktopLogin(state);
  const state = randomBytes(32).toString("base64url");
  pendingDesktopLogins.set(state, Date.now() + DESKTOP_LOGIN_TTL_MS);
  desktopLoginTimers.set(
    state,
    setTimeout(() => {
      if (!pendingDesktopLogins.has(state)) return;
      clearPendingDesktopLogin(state);
      publishDesktopLoginState("expired");
    }, DESKTOP_LOGIN_TTL_MS),
  );
  try {
    const confirmation = new URL("/auth/desktop-confirm/", desktopWebsiteUrl());
    confirmation.searchParams.set("state", state);
    confirmation.searchParams.set("callback", await ensureDesktopCallbackServer());
    const login = new URL("/login/", desktopWebsiteUrl());
    login.searchParams.set(
      "redirect",
      `${confirmation.pathname}${confirmation.search}`,
    );
    login.searchParams.set("desktop", "1");
    publishDesktopLoginState("waiting");
    await shell.openExternal(login.toString());
    return { ok: true };
  } catch (error) {
    clearPendingDesktopLogin(state);
    publishDesktopLoginState("failed");
    throw new Error("无法打开系统浏览器完成登录。", { cause: error });
  }
});
ipcMain.handle("desktop.cancel-browser-login", (event) => {
  requireMainWindow(event);
  for (const state of pendingDesktopLogins.keys())
    clearPendingDesktopLogin(state);
  desktopLoginCallbacks.clear();
  publishDesktopLoginState("canceled");
  return { ok: true };
});
ipcMain.handle("desktop.finish-browser-login", (event, success: unknown) => {
  requireMainWindow(event);
  if (typeof success !== "boolean")
    throw new Error("Desktop login result must be a boolean.");
  publishDesktopLoginState(success === true ? "completed" : "failed");
  return { ok: true };
});

ipcMain.handle("workspace.select", async (event) => {
  requireMainWindow(event);
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "选择本地项目目录",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const nextWorkspace = await LocalWorkspace.open(
    result.filePaths[0],
    join(app.getPath("userData"), "workspace-snapshots"),
  );
  for (const [requestId, controller] of desktopMcpCalls) {
    controller.abort();
    desktopMcpCalls.delete(requestId);
  }
  localWorkspace = nextWorkspace;
  localWorkspaceSessionId = randomUUID();
  publishDesktopMcpTools();
  return { root: localWorkspace.root, entries: await localWorkspace.tree() };
});
ipcMain.handle("workspace.tree", async (event) =>
  requireLocalWorkspace(event).tree(),
);
ipcMain.handle("workspace.read", async (event, path: unknown) => {
  if (typeof path !== "string")
    throw new Error("A relative project file path is required.");
  return requireLocalWorkspace(event).read(path);
});
ipcMain.handle(
  "workspace.write",
  async (event, input: { path?: unknown; content?: unknown }) => {
    if (typeof input?.path !== "string" || typeof input.content !== "string")
      throw new Error("A file path and text content are required.");
    return requireLocalWorkspace(event).write(input.path, input.content);
  },
);
ipcMain.handle("workspace.restore", async (event, snapshotId: unknown) => {
  if (typeof snapshotId !== "string")
    throw new Error("A snapshot id is required.");
  return requireLocalWorkspace(event).restore(snapshotId);
});
ipcMain.handle("workspace.git-status", (event) =>
  requireLocalWorkspace(event).gitStatus(),
);
ipcMain.handle("workspace.git-diff", (event, path?: unknown) => {
  if (path !== undefined && typeof path !== "string")
    throw new Error("Git diff path must be a relative path.");
  return requireLocalWorkspace(event).gitDiff(path);
});
ipcMain.handle("workspace.scripts", (event) =>
  requireLocalWorkspace(event).scripts(),
);
ipcMain.handle("workspace.run-script", (event, scriptName: unknown) => {
  const sender = requireMainWindow(event);
  if (typeof scriptName !== "string")
    throw new Error("A declared project script is required.");
  const workspace = requireLocalWorkspace(event);
  const runId = randomBytes(16).toString("hex");
  const controller = new AbortController();
  workspaceRuns.set(runId, controller);
  void workspace
    .runScript(
      scriptName,
      runId,
      (chunk) =>
        sender.webContents.send("workspace:script-output", { runId, chunk }),
      controller.signal,
    )
    .then((result) =>
      sender.webContents.send("workspace:script-finished", {
        runId,
        ok: true,
        exitCode: result.exitCode,
      }),
    )
    .catch((error: unknown) =>
      sender.webContents.send("workspace:script-finished", {
        runId,
        ok: false,
        message:
          error instanceof Error ? error.message : "Project script failed.",
      }),
    )
    .finally(() => workspaceRuns.delete(runId));
  return { runId };
});
ipcMain.handle("workspace.cancel-script", (event, runId: unknown) => {
  requireMainWindow(event);
  if (typeof runId !== "string") return { canceled: false };
  const controller = workspaceRuns.get(runId);
  if (!controller) return { canceled: false };
  controller.abort();
  localWorkspace?.cancelScript(runId);
  return { canceled: true };
});

function publishDesktopMcpTools() {
  if (
    !assistantConnectionId ||
    assistantSocket?.readyState !== 1 ||
    !mcpRegistry
  )
    return;
  void mcpRegistry
    .list()
    .then((servers) => {
      const tools: Array<{
        serverId: string;
        serverName: string;
        name: string;
        description?: string;
        inputSchema: Record<string, unknown>;
      }> = servers
        .filter((server) => server.connected)
        .flatMap((server) =>
          server.tools.map((tool) => ({
            serverId: server.id,
            serverName: server.name,
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.inputSchema,
          })),
        );
      if (localWorkspace && localWorkspaceSessionId) {
        tools.push(...createLocalProjectToolCatalog(localWorkspaceSessionId));
      }
      tools.push(...createNativeScreenToolCatalog());
      const catalog = desktopMcpToolCatalogSchema.parse({
        type: "desktop.mcp.tools",
        connectionId: assistantConnectionId,
        tools,
      });
      sendAssistant(catalog);
    })
    .catch((error: unknown) => {
      sendAssistant({
        type: "assistant.error",
        message:
          error instanceof Error
            ? error.message
            : "Could not publish the desktop MCP tool catalog.",
      });
    });
}

function createLocalProjectToolCatalog(serverId: string) {
  const objectSchema = (
    properties: Record<string, object>,
    required: string[] = [],
  ) => ({
    type: "object" as const,
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  });
  const stringField = (description: string) => ({
    type: "string",
    description,
  });
  const numberField = (
    description: string,
    minimum: number,
    maximum: number,
  ) => ({ type: "integer", minimum, maximum, description });


  return [
    {
      name: "list_files",
      description:
        "List non-secret project files. Use pathPrefix to narrow results.",
      inputSchema: objectSchema({
        pathPrefix: stringField("Optional project-relative path prefix."),
        limit: numberField("Maximum entries, default 100.", 1, 500),
        offset: numberField("Entry offset for pagination.", 0, 20_000),
      }),
    },
    {
      name: "read_file",
      description:
        "Read a text slice from an authorized project file. The returned code is sent to the active Helstera chat model for reasoning.",
      inputSchema: objectSchema(
        {
          path: stringField("Project-relative file path."),
          offset: numberField("Character offset, default 0.", 0, 2_000_000),
          limit: numberField("Characters to read, default 25000.", 1, 25_000),
        },
        ["path"],
      ),
    },
    {
      name: "write_file",
      description:
        "Write a project-relative text file after saving a recoverable snapshot. Never use for deletion or paths outside the selected folder.",
      inputSchema: objectSchema(
        {
          path: stringField("Project-relative file path."),
          content: stringField("Complete replacement text for the file."),
        },
        ["path", "content"],
      ),
    },
    {
      name: "git_status",
      description: "Read the current Git branch and working-tree status.",
      inputSchema: objectSchema({}),
    },
    {
      name: "git_diff",
      description:
        "Read the current unstaged Git diff, optionally for one project-relative file.",
      inputSchema: objectSchema({
        path: stringField("Optional project-relative file path."),
      }),
    },
    {
      name: "run_project_script",
      description:
        "Run a declared project test, build, typecheck, lint, or check script. Arbitrary shell commands and dependency installation are not available.",
      inputSchema: objectSchema(
        { name: stringField("Name of a declared safe project script.") },
        ["name"],
      ),
    },
  ].map((tool) => ({ serverId, serverName: "Local Project", ...tool }));
}

const NATIVE_SCREEN_SERVER_ID = "0e5c1a30-9f4a-4d0e-8a51-1b2c3d4e5f60";
const NATIVE_SCREEN_SERVER_NAME = "Native Screen";

function createNativeScreenToolCatalog(): Array<{
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  const objectSchema = (
    properties: Record<string, object>,
    required: string[] = [],
  ) => ({
    type: "object" as const,
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  });
  const stringField = (description: string) => ({ type: "string", description });
  const intField = (description: string, minimum: number, maximum: number) => ({
    type: "integer" as const,
    minimum,
    maximum,
    description,
  });
  return [
    {
      name: "screen_observe",
      description:
        "Inspect the active native window: accessible controls, OCR text (untrusted), and a screenshot. Read-only. Blocked automatically when password/OTP fields are visible.",
      inputSchema: objectSchema({
        preferVision: { type: "boolean", description: "Skip the accessibility tree and rely on visual/OCR evidence." },
      }),
    },
    {
      name: "screen_click",
      description:
        "Click the active native window at visible text, window-relative coordinates, or screenshot pixel coordinates (from a vision model reading the latest screen_observe screenshot). Prefer text for reliability.",
      inputSchema: objectSchema({
        text: stringField("Visible text to click, e.g. 'Save file'. Up to 160 characters."),
        x: intField("Window-relative x, used when text is absent.", 0, 100_000),
        y: intField("Window-relative y, used when text is absent.", 0, 100_000),
        screenshotX: intField("Screenshot pixel x from the latest screen_observe evidence, used for icons without text.", 0, 100_000),
        screenshotY: intField("Screenshot pixel y from the latest screen_observe evidence.", 0, 100_000),
        button: { type: "string", enum: ["left", "right"], description: "Mouse button, default left." },
        doubleClick: { type: "boolean", description: "Double-click instead of single click." },
      }),
    },
    {
      name: "screen_type",
      description:
        "Type text into an accessible native text field identified by its label. Credential fields are blocked.",
      inputSchema: objectSchema(
        {
          target: stringField("Accessible label of the target text field."),
          value: stringField("Text to type. Up to 10,000 characters."),
        },
        ["target", "value"],
      ),
    },
    {
      name: "screen_key",
      description:
        "Press a key (Enter/Tab/Escape/arrows/Home/End/PageUp/PageDown/F1-F12) with optional ctrl/alt/shift modifiers.",
      inputSchema: objectSchema(
        {
          key: stringField("Key name, e.g. 'Enter'."),
          modifiers: { type: "array", items: { type: "string", enum: ["ctrl", "alt", "shift", "meta", "cmd"] }, description: "Held modifiers." },
        },
        ["key"],
      ),
    },
    {
      name: "screen_scroll",
      description: "Scroll the window under the cursor horizontally and vertically.",
      inputSchema: objectSchema({
        dx: intField("Horizontal steps, negative scrolls left.", -100, 100),
        dy: intField("Vertical steps, negative scrolls up.", -100, 100),
      }),
    },
    {
      name: "screen_drag",
      description: "Drag from one window-relative point to another with the left button held.",
      inputSchema: objectSchema(
        {
          fromX: intField("Start x.", 0, 100_000),
          fromY: intField("Start y.", 0, 100_000),
          toX: intField("End x.", 0, 100_000),
          toY: intField("End y.", 0, 100_000),
        },
        ["fromX", "fromY", "toX", "toY"],
      ),
    },
    {
      name: "screen_wait_for_text",
      description:
        "Poll the active window's OCR text until the target text appears. Returns found=true/false. Use after clicks that trigger loading states.",
      inputSchema: objectSchema(
        {
          text: stringField("Text to wait for, e.g. 'Download complete'."),
          timeoutMs: intField("Timeout in milliseconds, default 10000, max 60000.", 1_000, 60_000),
        },
        ["text"],
      ),
    },
    {
      name: "screen_list_windows",
      description: "List visible top-level windows with titles and regions. Read-only. Use before switching windows.",
      inputSchema: objectSchema({
        limit: intField("Maximum windows returned, default 24.", 1, 64),
      }),
    },
    {
      name: "screen_focus_window",
      description:
        "Bring a window to the foreground by exact or partial title match. Subsequent screen tools will operate on it.",
      inputSchema: objectSchema(
        { title: stringField("Window title, exact or unique partial match.") },
        ["title"],
      ),
    },
    {
      name: "screen_clipboard_read",
      description: "Read up to 20,000 characters from the system clipboard. Read-only.",
      inputSchema: objectSchema({}),
    },
    {
      name: "screen_clipboard_write",
      description:
        "Write text to the system clipboard (up to 100,000 characters). Optionally paste it into the focused field with ctrl+V.",
      inputSchema: objectSchema({
        value: stringField("Text to place on the clipboard."),
        paste: { type: "boolean", description: "Send ctrl+V after writing. The target field must be focused." },
      }),
    },
    {
      name: "screen_launch_app",
      description:
        "Launch a desktop application by executable name or path (no shell metacharacters). Returns the new process id. Use screen_observe afterwards to see the new window.",
      inputSchema: objectSchema(
        { command: stringField("Executable name or absolute path, e.g. 'notepad' or 'C:\\\\Program Files\\\\app.exe'.") },
        ["command"],
      ),
    },
    {
      name: "screen_close_app",
      description:
        "Gracefully close an application by process id (sends WM_CLOSE/SIGTERM, does not force kill). Refuses to close Helstera Desktop itself.",
      inputSchema: objectSchema(
        { pid: { type: "integer", minimum: 1, description: "Process id from screen_launch_app." }, confirm: { type: "boolean", description: "Must be true to close." } },
        ["pid", "confirm"],
      ),
    },
    {
      name: "screen_find",
      description:
        "Locate an element in the active window screenshot by natural-language description using server-side visual grounding. Returns pixel coordinates for screen_click. Requires the server's visual analyzer.",
      inputSchema: objectSchema(
        { description: stringField("What to find, e.g. 'the red close button in the toolbar'.") },
        ["description"],
      ),
    },
  ].map((tool) => ({
    serverId: NATIVE_SCREEN_SERVER_ID,
    serverName: NATIVE_SCREEN_SERVER_NAME,
    ...tool,
  }));
}

async function runNativeScreenTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const userDataPath = app.getPath("userData");
  const platform = process.platform;
  const sessionType = process.env.XDG_SESSION_TYPE;
  switch (toolName) {
    case "screen_observe": {
      const evidence = await inspectNativeDesktop({
        platform,
        userDataPath,
        sessionType,
        preferVision: args.preferVision === true,
      });
      const includeScreenshot = args.includeScreenshot !== false;
      return JSON.stringify({
        windowTitle: evidence.windowTitle,
        windowRegion: evidence.windowRegion,
        controls: evidence.controls.slice(0, 80),
        ocrWords: evidence.ocrWords.slice(0, 500),
        ocrText: evidence.ocrText.slice(0, 6_000),
        pixelScale: evidence.pixelScale,
        screenshotWidth: evidence.screenshotWidth,
        screenshotHeight: evidence.screenshotHeight,
        ...(includeScreenshot
          ? {
              screenshotBase64: evidence.screenshotBase64.slice(0, 300_000),
              screenshotMimeType: evidence.screenshotMimeType,
              screenshotTruncated: evidence.screenshotBase64.length > 300_000,
            }
          : {}),
        ...(evidence.fallbackReason ? { fallbackReason: evidence.fallbackReason } : {}),
      });
    }
    case "screen_click": {
      const button = args.button === "right" ? "right" : "left";
      const double = args.doubleClick === true;
      if (typeof args.text === "string" && args.text.trim()) {
        const grounded = await clickGroundedTarget(
          { text: String(args.text) },
          userDataPath,
          button,
          double,
        );
        return JSON.stringify({ ok: true, x: Math.round(grounded.x), y: Math.round(grounded.y), source: grounded.source });
      }
      if (typeof args.screenshotX === "number" && typeof args.screenshotY === "number") {
        const evidence = await inspectNativeDesktop({ platform, userDataPath, sessionType, preferVision: true });
        const grounded = groundNativeTarget(
          { screenshotX: Number(args.screenshotX), screenshotY: Number(args.screenshotY) },
          evidence,
        );
        await clickNativeCoordinates(grounded.x, grounded.y, button, double);
        return JSON.stringify({ ok: true, x: Math.round(grounded.x), y: Math.round(grounded.y), source: "screenshot_pixel" });
      }
      if (typeof args.x === "number" && typeof args.y === "number") {
        const grounded = await clickGroundedTarget(
          { x: Number(args.x), y: Number(args.y) },
          userDataPath,
          button,
          double,
        );
        return JSON.stringify({ ok: true, x: Math.round(grounded.x), y: Math.round(grounded.y), source: grounded.source });
      }
      throw new Error("screen_click requires text, screenshotX/Y, or x/y coordinates.");
    }
    case "screen_type": {
      const target = typeof args.target === "string" ? args.target : "";
      const value = typeof args.value === "string" ? args.value : "";
      await typeIntoNativeControl(target, value, userDataPath);
      return JSON.stringify({ ok: true });
    }
    case "screen_key": {
      const key = typeof args.key === "string" ? args.key : "";
      const modifiers = Array.isArray(args.modifiers)
        ? args.modifiers.filter((m): m is string => typeof m === "string")
        : [];
      await pressNativeKey(key, modifiers);
      return JSON.stringify({ ok: true });
    }
    case "screen_scroll": {
      const dx = typeof args.dx === "number" ? args.dx : 0;
      const dy = typeof args.dy === "number" ? args.dy : 0;
      await scrollNativeWindow(dx, dy);
      return JSON.stringify({ ok: true });
    }
    case "screen_drag": {
      const evidence = await inspectNativeDesktop({ platform, userDataPath, sessionType, preferVision: false });
      await dragNativeMouse(
        Number(args.fromX),
        Number(args.fromY),
        Number(args.toX),
        Number(args.toY),
        evidence.windowRegion,
      );
      return JSON.stringify({ ok: true });
    }
    case "screen_wait_for_text": {
      const result = await waitForNativeText(
        typeof args.text === "string" ? args.text : "",
        userDataPath,
        { timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined },
      );
      return JSON.stringify(result);
    }
    case "screen_list_windows": {
      const windows = await listNativeWindows(
        typeof args.limit === "number" ? Number(args.limit) : 24,
      );
      return JSON.stringify({ windows });
    }
    case "screen_focus_window": {
      const result = await focusNativeWindowByTitle(
        typeof args.title === "string" ? args.title : "",
      );
      return JSON.stringify(result);
    }
    case "screen_clipboard_read": {
      const text = await readNativeClipboard();
      return JSON.stringify({ text });
    }
    case "screen_clipboard_write": {
      await writeNativeClipboard(typeof args.value === "string" ? args.value : "");
      if (args.paste === true) await pasteNativeClipboard(userDataPath);
      return JSON.stringify({ ok: true, pasted: args.paste === true });
    }
    case "screen_launch_app": {
      const launched = await launchApplication(typeof args.command === "string" ? args.command : "");
      return JSON.stringify(launched);
    }
    case "screen_close_app": {
      if (args.confirm !== true) throw new Error("screen_close_app requires confirm=true.");
      const result = await closeApplicationByPid(Number(args.pid));
      return JSON.stringify(result);
    }
    case "screen_find": {
      const description = typeof args.description === "string" ? args.description : "";
      const requestId = randomUUID();
      const coordinate = await new Promise<{ found: boolean; x: number; y: number; confidence: number }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingVisionCoordinates.delete(requestId);
          reject(new Error("Visual grounding timed out."));
        }, 25_000);
        pendingVisionCoordinates.set(requestId, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error: Error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        sendAssistant({ type: "desktop_agent.vision_request", requestId, description: description.slice(0, 500) });
      });
      return JSON.stringify(coordinate);
    }
    default:
      throw new Error(`Unknown native screen tool: ${toolName}`);
  }
}

function clippedUtf8(value: string, maxBytes = 100_000) {  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return { text: value, truncated: false };
  let text = bytes.subarray(0, maxBytes).toString("utf8");
  if (text.endsWith("\uFFFD")) text = text.slice(0, -1);
  return { text, truncated: true };
}

function requiredString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "string")
    throw new Error(`A ${key} string is required.`);
  return value;
}

async function runLocalProjectTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) {
  const workspace = localWorkspace;
  if (!workspace || !serverId || serverId !== localWorkspaceSessionId)
    throw new Error("The selected local project authorization has changed.");
  if (signal.aborted) throw new Error("The Agent request was canceled.");
  switch (toolName) {
    case "list_files": {
      const prefix =
        typeof args.pathPrefix === "string"
          ? args.pathPrefix.replaceAll("\\", "/")
          : "";
      const offset = Number.isInteger(args.offset) ? Number(args.offset) : 0;
      const limit = Number.isInteger(args.limit) ? Number(args.limit) : 100;
      if (offset < 0 || offset > 20_000 || limit < 1 || limit > 500)
        throw new Error(
          "File listing pagination is outside the allowed range.",
        );
      const entries = (await workspace.tree()).filter(
        (entry) =>
          !prefix || entry.path.replaceAll("\\", "/").startsWith(prefix),
      );
      return JSON.stringify({
        entries: entries.slice(offset, offset + limit),
        total: entries.length,
        nextOffset: offset + limit < entries.length ? offset + limit : null,
      });
    }
    case "read_file": {
      const path = requiredString(args, "path");
      const offset = Number.isInteger(args.offset) ? Number(args.offset) : 0;
      const limit = Number.isInteger(args.limit) ? Number(args.limit) : 25_000;
      if (offset < 0 || offset > 2_000_000 || limit < 1 || limit > 25_000)
        throw new Error("File read range is outside the allowed limit.");
      const file = await workspace.read(path);
      return JSON.stringify({
        path: file.path,
        content: file.content.slice(offset, offset + limit),
        offset,
        nextOffset:
          offset + limit < file.content.length ? offset + limit : null,
      });
    }
    case "write_file": {
      const saved = await workspace.write(
        requiredString(args, "path"),
        requiredString(args, "content"),
      );
      return JSON.stringify({
        ...saved,
        snapshot: "A recoverable snapshot was saved before the write.",
      });
    }
    case "git_status":
      return workspace.gitStatus();
    case "git_diff":
      return workspace.gitDiff(
        typeof args.path === "string" ? args.path : undefined,
      );
    case "run_project_script": {
      const name = requiredString(args, "name");
      if (!(await workspace.scripts()).some((script) => script.name === name))
        throw new Error(
          "Only declared test/build/typecheck/lint/check scripts can run.",
        );
      const runId = randomUUID();
      let output = "";
      let failure: string | undefined;
      try {
        await workspace.runScript(
          name,
          runId,
          (chunk) => {
            output += chunk;
          },
          signal,
        );
      } catch (error) {
        failure =
          error instanceof Error ? error.message : "Project script failed.";
      }
      const clipped = clippedUtf8(output);
      return JSON.stringify({
        name,
        output: clipped.text,
        ...(clipped.truncated ? { outputTruncated: true } : {}),
        ...(failure ? { error: failure } : { exitCode: 0 }),
      });
    }
    default:
      throw new Error("The local project tool is not available.");
  }
}

async function runDesktopMcpCall(input: unknown) {
  const parsed = desktopMcpToolCallSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.connectionId !== assistantConnectionId ||
    !mcpRegistry
  )
    return;
  const call = parsed.data;
  const controller = new AbortController();
  desktopMcpCalls.set(call.requestId, controller);
  try {
    const isNativeScreenCall = call.serverId === NATIVE_SCREEN_SERVER_ID;
    const isLocalWorkspaceCall = call.serverId === localWorkspaceSessionId;
    const rawOutput = isNativeScreenCall
      ? await runNativeScreenTool(call.toolName, call.arguments)
      : isLocalWorkspaceCall
      ? await runLocalProjectTool(
          call.serverId,
          call.toolName,
          call.arguments,
          controller.signal,
        )
      : await mcpRegistry.call(
          call.serverId,
          call.toolName,
          JSON.stringify(call.arguments),
          controller.signal,
        );
    if (
      !isNativeScreenCall &&
      !isLocalWorkspaceCall &&
      (JSON.parse(rawOutput) as { isError?: boolean }).isError
    ) {
      const output = clippedUtf8(rawOutput, 2_000).text;
      sendAssistant({
        type: "desktop.mcp.result",
        requestId: call.requestId,
        connectionId: call.connectionId,
        ok: false,
        error: output.slice(0, 2_000),
      });
      return;
    }
    const output = clippedUtf8(rawOutput, 320_000).text;
    sendAssistant({
      type: "desktop.mcp.result",
      requestId: call.requestId,
      connectionId: call.connectionId,
      ok: true,
      result: output,
    });
  } catch (error) {
    sendAssistant({
      type: "desktop.mcp.result",
      requestId: call.requestId,
      connectionId: call.connectionId,
      ok: false,
      error:
        error instanceof Error
          ? error.message.slice(0, 2_000)
          : "MCP tool call failed.",
    });
  } finally {
    desktopMcpCalls.delete(call.requestId);
  }
}
ipcMain.handle("mcp.list", (event) => requireMcpRegistry(event).list());
ipcMain.handle("mcp.add", async (event, input: unknown) => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("MCP server settings are required.");
  const saved = await requireMcpRegistry(event).add(input as McpServerInput);
  publishDesktopMcpTools();
  return saved;
});
ipcMain.handle("mcp.connect", (event, id: unknown) => {
  if (typeof id !== "string") throw new Error("An MCP server id is required.");
  return requireMcpRegistry(event)
    .connect(id)
    .then((servers) => {
      publishDesktopMcpTools();
      return servers;
    });
});
ipcMain.handle("mcp.disconnect", (event, id: unknown) => {
  if (typeof id !== "string") throw new Error("An MCP server id is required.");
  return requireMcpRegistry(event)
    .disconnect(id)
    .then((servers) => {
      publishDesktopMcpTools();
      return servers;
    });
});
ipcMain.handle("mcp.remove", (event, id: unknown) => {
  if (typeof id !== "string") throw new Error("An MCP server id is required.");
  return requireMcpRegistry(event)
    .remove(id)
    .then((servers) => {
      publishDesktopMcpTools();
      return servers;
    });
});
ipcMain.handle("mcp.call", (event, input: unknown) => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("An MCP tool call is required.");
  const call = input as { id?: unknown; name?: unknown; arguments?: unknown };
  if (
    typeof call.id !== "string" ||
    typeof call.name !== "string" ||
    typeof call.arguments !== "string"
  )
    throw new Error("MCP tool call fields are invalid.");
  return requireMcpRegistry(event).call(call.id, call.name, call.arguments);
});

function isSafeBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function openEmbeddedBrowser(value: string) {
  if (!isSafeBrowserUrl(value))
    throw new Error("仅允许打开 HTTP(S) 网站地址。");
  if (!embeddedBrowserWindow || embeddedBrowserWindow.isDestroyed()) {
    embeddedBrowserWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      title: "Helstera 本地浏览器",
      webPreferences: {
        partition: "persist:helstera-website-assistant",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    embeddedBrowserWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeBrowserUrl(url)) void embeddedBrowserWindow?.loadURL(url);
      return { action: "deny" };
    });
    embeddedBrowserWindow.webContents.on("will-navigate", (event, url) => {
      if (!isSafeBrowserUrl(url)) event.preventDefault();
    });
    embeddedBrowserWindow.on("closed", () => {
      embeddedBrowserWindow = null;
    });
  }
  await embeddedBrowserWindow.loadURL(value);
  embeddedBrowserWindow.show();
  embeddedBrowserWindow.focus();
  return { ok: true };
}

function sendAssistant(message: Record<string, unknown>) {
  if (message.type === "desktop_agent.event")
    mainWindow?.webContents.send("desktop:agent-event", message);
  if (assistantSocket?.readyState === 1)
    assistantSocket.send(JSON.stringify(message));
}

type NativeScreenRecording = {
  stop: () => Promise<string | null>;
};

const RECORDING_INLINE_LIMIT = 8 * 1024 * 1024;
const RECORDING_CHUNK_BYTES = 3 * 1024 * 1024;

async function sendRecordingPayload(taskId: string, base64: string): Promise<void> {
  const payload = base64.startsWith("data:") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const byteLength = Math.floor((payload.length * 3) / 4);
  if (byteLength <= RECORDING_INLINE_LIMIT) {
    sendAssistant({
      type: "desktop_agent.event",
      taskId,
      eventType: "evidence",
      detail: "Native screen recording captured.",
      result: {
        summary: "Native screen recording captured.",
        evidence: [{ kind: "recording", title: "Native screen recording" }],
        recordingBase64: `data:video/webm;base64,${payload}`,
      },
    });
    return;
  }
  const uploadId = randomUUID();
  const totalChunks = Math.ceil(payload.length / (RECORDING_CHUNK_BYTES - (RECORDING_CHUNK_BYTES % 4)));
  const chunkSize = Math.ceil(payload.length / totalChunks / 4) * 4;
  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = payload.slice(index * chunkSize, (index + 1) * chunkSize);
    sendAssistant({
      type: "desktop_agent.recording_chunk",
      taskId,
      uploadId,
      chunkIndex: index,
      totalChunks,
      isLast: index === totalChunks - 1,
      data: chunk,
    });
  }
}

async function startNativeScreenRecording(options: { withAudio?: boolean } = {}): Promise<NativeScreenRecording> {
  const { desktopCapturer } = await import("electron");
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1, height: 1 },
  });
  const source = sources[0];
  if (!source) throw new Error("No screen source is available for native recording.");
  const recorder = await ensureRecorderWindow();
  const withAudio = options.withAudio !== false;
  const started = new Promise<void>((resolve, reject) => {
    const onStarted = () => {
      cleanup();
      resolve();
    };
    const onFailed = (_event: Electron.IpcMainEvent, message: string) => {
      cleanup();
      reject(new Error(message || "Native screen recording failed to start."));
    };
    const cleanup = () => {
      ipcMain.removeListener("recorder.native-started", onStarted);
      ipcMain.removeListener("recorder.native-failed", onFailed);
    };
    ipcMain.once("recorder.native-started", onStarted);
    ipcMain.once("recorder.native-failed", onFailed);
    setTimeout(() => {
      cleanup();
      reject(new Error("Native screen recording did not start in time."));
    }, 8_000);
  });
  recorder.webContents.send("recorder.start-native", source.id, withAudio);
  await started;
  let stopped = false;
  return {
    stop: () =>
      new Promise<string | null>((resolve) => {
        if (stopped || recorder.isDestroyed()) {
          resolve(null);
          return;
        }
        stopped = true;
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          ipcMain.removeListener("recorder.complete", onComplete);
          resolve(null);
        }, 15_000);
        const onComplete = (_event: Electron.IpcMainEvent, base64: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          ipcMain.removeListener("recorder.complete", onComplete);
          resolve(typeof base64 === "string" && base64.length > 0 ? base64 : null);
        };
        ipcMain.once("recorder.complete", onComplete);
        recorder.webContents.send("recorder.stop");
      }),
  };
}

async function ensureRecorderWindow() {
  if (recorderWindow && !recorderWindow.isDestroyed()) return recorderWindow;
  recorderWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "recorder-preload.js"),
    },
  });
  recorderWindow.on("closed", () => {
    recorderWindow = null;
  });
  await recorderWindow.loadURL(
    "data:text/html,<canvas id=canvas width=1280 height=720></canvas>",
  );
  return recorderWindow;
}

async function startDesktopRecording(browser: BrowserWindow) {
  const recorder = await ensureRecorderWindow();
  recorder.webContents.send("recorder.start");
  let busy = false;
  const timer = setInterval(() => {
    if (busy || recorder.isDestroyed() || browser.isDestroyed()) return;
    busy = true;
    void browser.webContents
      .capturePage()
      .then((image) => {
        if (!recorder.isDestroyed())
          recorder.webContents.send(
            "recorder.frame",
            image.toJPEG(70).toString("base64"),
          );
      })
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  }, 200);
  return { recorder, timer };
}

async function stopDesktopRecording(active: {
  recorder: BrowserWindow;
  timer: ReturnType<typeof setInterval>;
}) {
  clearInterval(active.timer);
  if (active.recorder.isDestroyed()) return null;
  return new Promise<string | null>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const onComplete = (_event: Electron.IpcMainEvent, base64: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ipcMain.removeListener("recorder.complete", onComplete);
      resolve(typeof base64 === "string" && base64.length > 0 ? base64 : null);
    };
    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("recorder.complete", onComplete);
      resolve(null);
    }, 8_000);
    ipcMain.once("recorder.complete", onComplete);
    active.recorder.webContents.send("recorder.stop");
  });
}

async function captureEmbeddedPage(task: any) {
  const browser = embeddedBrowserWindow;
  if (!browser || browser.isDestroyed())
    throw new Error("桌面内嵌浏览器未打开。");
  desktopTaskTabs.set(String(task.taskId), browser);
  const recording = task.recordVideo
    ? await startDesktopRecording(browser)
    : null;
  let recordingBase64: string | null = null;
  const startUrl = new URL(String(task.startUrl));
  const queue = [startUrl.toString()];
  const visited = new Set<string>();
  let recordingStopped = false;
  try {
    while (
      queue.length &&
      visited.size < Number(task.pageLimit) &&
      !browser.isDestroyed()
    ) {
      const next = queue.shift();
      if (!next || visited.has(next)) continue;
      visited.add(next);
      if (browser.webContents.getURL() !== next) await browser.loadURL(next);
      const loadedUrl = new URL(browser.webContents.getURL() || next);
      if (
        !isAllowedDesktopDestination(
          loadedUrl,
          startUrl,
          Boolean(task.followExternal),
        )
      )
        throw new Error("自动跟链或重定向扩展到了未授权的本地地址。");
      const page = await browser.webContents.executeJavaScript(`(() => {
    const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, 500);
    return {
      url: location.href,
      title: clean(document.title) || location.hostname,
      description: clean(document.querySelector('meta[name="description"]')?.content ?? document.querySelector('meta[property="og:description"]')?.content),
      headings: [...document.querySelectorAll('h1,h2,h3')].map((node) => clean(node.textContent)).filter(Boolean).slice(0, 16),
      navigation: [...document.querySelectorAll('header a,nav a')].map((node) => clean(node.textContent)).filter(Boolean).slice(0, 24),
      links: [...new Set([...document.querySelectorAll('a[href]')].map((anchor) => anchor.href).filter((href) => /^https?:\\/\\//i.test(href)))].slice(0, 80),
    };
  })()`);
      const screenshotBase64 = `data:image/jpeg;base64,${(await browser.webContents.capturePage()).toJPEG(76).toString("base64")}`;
      sendAssistant({
        type: "website_capture.page",
        taskId: task.taskId,
        page,
        screenshotBase64,
      });
      sendAssistant({
        type: "website_capture.progress",
        taskId: task.taskId,
        progress: 10 + Math.round((visited.size / Number(task.pageLimit)) * 70),
        stage: "page_loading",
        detail: `已读取 ${visited.size}/${task.pageLimit} 个页面`,
      });
      for (const link of Array.isArray(page.links) ? page.links : []) {
        try {
          const linkUrl = new URL(String(link));
          if (
            (Boolean(task.followExternal) ||
              linkUrl.hostname.toLowerCase() ===
                startUrl.hostname.toLowerCase()) &&
            isAllowedDesktopDestination(
              linkUrl,
              startUrl,
              Boolean(task.followExternal),
            ) &&
            !visited.has(linkUrl.toString()) &&
            !queue.includes(linkUrl.toString())
          )
            queue.push(linkUrl.toString());
        } catch {
          /* malformed links are ignored */
        }
        if (queue.length >= Number(task.pageLimit) * 3) break;
      }
    }
    if (recording) {
      recordingBase64 = await stopDesktopRecording(recording);
      recordingStopped = true;
    }
    if (task.recordVideo && !recordingBase64)
      sendAssistant({
        type: "website_capture.recording_failed",
        taskId: task.taskId,
        message: "桌面内嵌浏览器录屏编码失败，已保存页面截图。",
      });
    sendAssistant({
      type: "website_capture.complete",
      taskId: task.taskId,
      ...(recordingBase64
        ? { recordingBase64: `data:video/webm;base64,${recordingBase64}` }
        : {}),
    });
  } finally {
    if (recording && !recordingStopped) await stopDesktopRecording(recording);
    desktopTaskTabs.delete(String(task.taskId));
  }
}

async function readEmbeddedPage(browser: BrowserWindow) {
  return browser.webContents.executeJavaScript(`(() => {
    const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, 500);
    const safeUrl = new URL(location.href);
    safeUrl.search = '';
    safeUrl.hash = '';
    return {
      url: safeUrl.toString(),
      title: clean(document.title) || location.hostname,
      description: clean(document.querySelector('meta[name="description"]')?.content ?? document.querySelector('meta[property="og:description"]')?.content),
      headings: [...document.querySelectorAll('h1,h2,h3')].map((node) => clean(node.textContent)).filter(Boolean).slice(0, 16),
      navigation: [...document.querySelectorAll('header a,nav a')].map((node) => clean(node.textContent)).filter(Boolean).slice(0, 24),
    };
  })()`);
}

function desktopCapabilityForAction(action: DesktopAgentAction) {
  const capabilities: Record<DesktopAgentAction["kind"], string> = {
    focus_window: "window.focus",
    read_page: "browser.read",
    navigate: "browser.navigate",
    scroll: "browser.scroll",
    capture_screen: "browser.capture",
    start_recording: "browser.record",
    stop_recording: "browser.record",
    click: "browser.click",
    type: "browser.type",
    native_click: "window.click",
    native_type: "window.type",
    native_key: "window.key",
    native_scroll: "window.scroll",
    native_drag: "window.drag",
    native_double_click: "window.click",
    native_right_click: "window.click",
    wait: "window.click",
    native_wait_for_text: "screen.read",
  };
  return capabilities[action.kind];
}

function isNativeDesktopTask(task: DesktopAgentTask) {
  return task.executionMode === "windows_ui" || task.executionMode === "visual_ocr";
}

function finishDesktopAgentTask(taskId: string) {
  desktopAgentPlans.delete(taskId);
  desktopAgentTasks.delete(taskId);
  desktopTaskTabs.delete(taskId);
  desktopAgentRounds.delete(taskId);
  const recording = nativeTaskRecordings.get(taskId);
  if (recording) {
    nativeTaskRecordings.delete(taskId);
    void recording.stop().catch(() => undefined);
  }
}

async function completeDesktopAgentTask(taskId: string) {
  const task = desktopAgentTasks.get(taskId);
  if (!task) return;
  try {
    let recordingBase64: string | null = null;
    const recording = nativeTaskRecordings.get(taskId);
    if (recording) {
      nativeTaskRecordings.delete(taskId);
      recordingBase64 = await recording.stop();
    }
    if (isNativeDesktopTask(task)) {
      const evidence = await inspectNativeDesktop({
        platform: process.platform,
        userDataPath: app.getPath("userData"),
        sessionType: process.env.XDG_SESSION_TYPE,
        preferVision: task.executionMode === "visual_ocr",
      });
      const summary = [`Active window: ${evidence.windowTitle}`, evidence.ocrText].filter(Boolean).join("\n\n").slice(0, 8_000);
      if (recordingBase64) await sendRecordingPayload(taskId, recordingBase64);
      sendAssistant({
        type: "desktop_agent.event",
        taskId,
        eventType: "completed",
        progress: 100,
        detail: "Native window task completed.",
        result: {
          summary,
          evidence: [{ kind: "window", title: evidence.windowTitle, excerpt: evidence.controls.map((control) => control.title).join("; ").slice(0, 8_000) }, ...(evidence.ocrText ? [{ kind: "ocr", title: evidence.windowTitle, excerpt: evidence.ocrText }] : [])],
          screenshotBase64: evidence.screenshotBase64,
          screenshotMimeType: evidence.screenshotMimeType,
        },
      });
    } else {
      const browser = desktopTaskTabs.get(taskId);
      if (!browser || browser.isDestroyed()) throw new Error("The task browser was closed before the plan finished.");
      const page = task.capabilities.includes("browser.read") ? await readEmbeddedPage(browser) : undefined;
      const screenshotBase64 = task.capabilities.includes("browser.capture") ? (await browser.webContents.capturePage()).toJPEG(76).toString("base64") : undefined;
      const summary = [page?.title, page?.description, ...(page?.headings ?? []).slice(0, 5)].filter(Boolean).join("\n").slice(0, 8_000);
      if (recordingBase64) await sendRecordingPayload(taskId, recordingBase64);
      sendAssistant({
        type: "desktop_agent.event",
        taskId,
        eventType: "completed",
        progress: 100,
        detail: "Desktop browser task completed.",
        result: {
          summary,
          ...(page ? { page, evidence: [{ kind: "page", sourceUrl: page.url, title: page.title, excerpt: summary }] } : {}),
          ...(screenshotBase64 ? { screenshotBase64 } : {}),
        },
      });
    }
  } catch (error) {
    sendAssistant({ type: "desktop_agent.event", taskId, eventType: "failed", detail: error instanceof Error ? error.message : "Could not collect final task evidence." });
  } finally {
    finishDesktopAgentTask(taskId);
  }
}

async function continueDesktopAgentPlan(taskId: string) {
  const task = desktopAgentTasks.get(taskId);
  if (!task) return;
  const plan = desktopAgentPlans.get(taskId) ?? [];
  const action = plan[0];
  if (!action) {
    const currentRound = desktopAgentRounds.get(taskId) ?? 0;
    if (isNativeDesktopTask(task) && task.maxDurationSeconds > 0 && currentRound < MAX_NATIVE_AGENT_ROUNDS) {
      const nextRound = currentRound + 1;
      desktopAgentRounds.set(taskId, nextRound);
      const evidence = await inspectNativeDesktop({
        platform: process.platform,
        userDataPath: app.getPath("userData"),
        sessionType: process.env.XDG_SESSION_TYPE,
        preferVision: task.executionMode === "visual_ocr",
      });
      sendAssistant({
        type: "desktop_agent.event",
        taskId,
        eventType: "step",
        stepId: "reobserve",
        progress: 70,
        detail: `Plan exhausted; requesting round ${nextRound} from the planner.`,
        result: {
          summary: evidence.ocrText.slice(0, 4_000),
          evidence: [{ kind: "window", title: evidence.windowTitle, excerpt: evidence.controls.map((control) => control.title).join("; ").slice(0, 4_000) }],
          screenshotBase64: evidence.screenshotBase64,
          screenshotMimeType: evidence.screenshotMimeType,
        },
      });
      sendAssistant({ type: "desktop_agent.observe", taskId, round: nextRound, goal: task.goal, observation: evidence.ocrText.slice(0, 4_000), windowTitle: evidence.windowTitle });
      return;
    }
    await completeDesktopAgentTask(taskId);
    return;
  }
  if (classifyDesktopAction(action) === "deny") {
    sendAssistant({
      type: "desktop_agent.event",
      taskId,
      eventType: "approval_required",
      action,
      detail: `Approval required before ${action.kind}.`,
    });
    return;
  }
  await executeDesktopAgentAction(action);
}

async function runDesktopAgentTask(rawTask: unknown) {
  const parsed = desktopAgentTaskSchema.safeParse(rawTask);
  if (!parsed.success) {
    sendAssistant({
      type: "assistant.error",
      message: "桌面协作任务格式无效。",
    });
    return;
  }
  const task = parsed.data;
  try {
    if (task.capabilities.includes("browser.record")) {
      try {
        nativeTaskRecordings.set(task.taskId, await startNativeScreenRecording());
      } catch (error) {
        sendAssistant({
          type: "desktop_agent.event",
          taskId: task.taskId,
          eventType: "failed",
          detail: error instanceof Error ? error.message : "原生录屏启动失败。",
        });
        return;
      }
    }
    if (task.executionMode === "windows_ui" || task.executionMode === "visual_ocr") {
      const evidence = await inspectNativeDesktop({
        platform: process.platform,
        userDataPath: app.getPath("userData"),
        sessionType: process.env.XDG_SESSION_TYPE,
        preferVision: task.executionMode === "visual_ocr",
      });
      const controls = evidence.controls.map((control) => `${control.role ?? "control"}: ${control.title}`).join("\n");
      const summary = [
        `Active window: ${evidence.windowTitle}`,
        ...(controls ? [`Accessible controls:\n${controls}`] : []),
        ...(evidence.ocrText ? [`Visible text (untrusted):\n${evidence.ocrText}`] : []),
        ...(evidence.fallbackReason ? [`Fallback: ${evidence.fallbackReason}`] : []),
      ].join("\n\n").slice(0, 8_000);
      desktopAgentTasks.set(task.taskId, task);
      desktopTaskTabs.set(task.taskId, null);
      sendAssistant({ type: "desktop_agent.event", taskId: task.taskId, eventType: "plan", progress: 5, detail: "Inspect the active native window and collect local evidence." });
      sendAssistant({ type: "desktop_agent.event", taskId: task.taskId, eventType: "step", stepId: "inspect-native-window", progress: 35, detail: evidence.fallbackReason ?? "Read the active window's accessible controls." });
      sendAssistant({
        type: "desktop_agent.event",
        taskId: task.taskId,
        eventType: "evidence",
        stepId: "inspect-native-window",
        progress: 80,
        detail: summary.slice(0, 2_000),
      });
      desktopAgentPlans.set(task.taskId, [...task.plannedActions]);
      if (task.plannedActions.length > 0) await continueDesktopAgentPlan(task.taskId);
      else await completeDesktopAgentTask(task.taskId);
      return;
    }
    if (task.executionMode === "connected_browser_tab") {
      sendAssistant({ type: "desktop_agent.event", taskId: task.taskId, eventType: "failed", detail: "Connected-tab tasks run on the browser extension channel; this desktop connection cannot execute them. Install the Helstera Local Browser Assistant and retry." });
      return;
    }
    const browser = embeddedBrowserWindow;
    if (!browser || browser.isDestroyed())
      throw new Error("请先打开桌面内嵌浏览器。");
    if (task.targetUrl) {
      const target = new URL(task.targetUrl);
      if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
        throw new Error("Desktop Agent accepts only credential-free HTTP(S) URLs.");
      }
      await openEmbeddedBrowser(target.toString());
    }
    desktopAgentTasks.set(task.taskId, task);
  desktopTaskTabs.set(task.taskId, browser);
    sendAssistant({
      type: "desktop_agent.event",
      taskId: task.taskId,
      eventType: "plan",
      progress: 2,
      detail: "读取当前页面并收集可复核证据",
    });
    sendAssistant({ type: "desktop_agent.event", taskId: task.taskId, eventType: "step", stepId: "inspect-page", progress: 25, detail: "读取页面标题、说明和导航结构" });
    const page = task.capabilities.includes("browser.read")
      ? await readEmbeddedPage(browser)
      : undefined;
    const screenshotBase64 = task.capabilities.includes("browser.capture")
      ? (await browser.webContents.capturePage()).toJPEG(76).toString("base64")
      : undefined;
    if (!page && !screenshotBase64) throw new Error("该任务没有请求当前浏览器可执行的能力。");
    const summary = page
      ? [page.title, page.description, ...(page.headings ?? []).slice(0, 5)].filter(Boolean).join("\n")
      : "已捕获当前桌面浏览器画面。";
    sendAssistant({ type: "desktop_agent.event", taskId: task.taskId, eventType: "evidence", stepId: "inspect-page", progress: 80, detail: "页面证据已收集" });
    sendAssistant({
      type: "desktop_agent.event",
      taskId: task.taskId,
      eventType: "evidence",
      stepId: "inspect-page",
      progress: 80,
      detail: "桌面协作任务已完成",
      result: {
        summary,
        ...(page ? { evidence: [{ kind: "page", sourceUrl: page.url, title: page.title, excerpt: summary.slice(0, 8_000) }] } : {}),
        ...(page ? { page } : {}),
        ...(screenshotBase64 ? { screenshotBase64 } : {}),
      },
    });
    desktopAgentPlans.set(task.taskId, [...task.plannedActions]);
    if (task.plannedActions.length > 0) {
      await continueDesktopAgentPlan(task.taskId);
      return;
    }
    await completeDesktopAgentTask(task.taskId);
  } catch (error) {
    sendAssistant({
      type: "desktop_agent.event",
      taskId: task.taskId,
      eventType: "failed",
      detail: error instanceof Error ? error.message : "桌面协作任务失败",
    });
  } finally {
    if (!desktopAgentPlans.has(task.taskId)) finishDesktopAgentTask(task.taskId);
  }
}

async function executeDesktopAgentAction(rawAction: unknown) {
  const parsed = desktopAgentActionSchema.safeParse(rawAction);
  if (!parsed.success) return;
  const action = parsed.data;
  const task = desktopAgentTasks.get(action.taskId);
  const browser = desktopTaskTabs.get(action.taskId);
  const capability = desktopCapabilityForAction(action);
  if (
    !task ||
    browser === undefined ||
    (browser === null && !isNativeDesktopTask(task)) ||
    (browser !== null && browser.isDestroyed()) ||
    !capability ||
    !task.capabilities.includes(
      capability as DesktopAgentTask["capabilities"][number],
    )
  ) {
    sendAssistant({
      type: "desktop_agent.event",
      taskId: action.taskId,
      eventType: "failed",
      detail: "Agent 没有该桌面能力或任务已结束",
    });
    return;
  }
  if (classifyDesktopAction(action) === "deny") {
    sendAssistant({
      type: "desktop_agent.event",
      taskId: action.taskId,
      eventType: "approval_required",
      action,
      detail: "该动作需要用户批准，或涉及禁止的凭据字段",
    });
    return;
  }
  try {
    if (isNativeDesktopTask(task)) {
      if (action.kind === "native_click" || action.kind === "native_double_click" || action.kind === "native_right_click") {
        const button = action.kind === "native_right_click" ? "right" : "left";
        const double = action.kind === "native_double_click";
        const hasCoordinates = typeof action.x === "number" && typeof action.y === "number";
        if (hasCoordinates || (!action.target && hasCoordinates)) {
          const grounded = await clickGroundedTarget({ x: action.x, y: action.y, text: action.target }, app.getPath("userData"), button, double);
          sendAssistant({
            type: "desktop_agent.event",
            taskId: action.taskId,
            eventType: "progress",
            detail: `grounded ${action.kind} at (${Math.round(grounded.x)}, ${Math.round(grounded.y)}) via ${grounded.source}`,
          });
        } else {
          await clickNativeText(String(action.target ?? ""), app.getPath("userData"));
        }
      } else if (action.kind === "native_type") {
        await typeIntoNativeControl(String(action.target ?? ""), String(action.value ?? ""), app.getPath("userData"));
      } else if (action.kind === "native_key") {
        await pressNativeKey(String(action.key ?? ""), action.modifiers ?? []);
      } else if (action.kind === "native_scroll") {
        await scrollNativeWindow(Number(action.dx ?? 0), Number(action.dy ?? 0));
      } else if (action.kind === "native_drag") {
        const dragEvidence = await inspectNativeDesktop({
          platform: process.platform,
          userDataPath: app.getPath("userData"),
          sessionType: process.env.XDG_SESSION_TYPE,
          preferVision: false,
        });
        await dragNativeMouse(Number(action.x), Number(action.y), Number(action.toX), Number(action.toY), dragEvidence.windowRegion);
      } else if (action.kind === "wait") {
        const duration = Math.min(10_000, Math.max(50, Number(action.durationMs ?? 500)));
        await new Promise((resolve) => setTimeout(resolve, duration));
      } else if (action.kind === "native_wait_for_text") {
        const result = await waitForNativeText(String(action.target ?? ""), app.getPath("userData"), {
          timeoutMs: action.durationMs,
        });
        if (!result.found) throw new Error(`wait_for_text timed out after ${Math.round(result.elapsedMs / 1000)}s: the text never appeared.`);
      } else if (action.kind === "start_recording") {
        if (nativeTaskRecordings.has(action.taskId)) throw new Error("A native recording is already active for this task.");
        nativeTaskRecordings.set(action.taskId, await startNativeScreenRecording());
      } else if (action.kind === "stop_recording") {
        const active = nativeTaskRecordings.get(action.taskId);
        if (!active) throw new Error("No native recording is active for this task.");
        nativeTaskRecordings.delete(action.taskId);
        const base64 = await active.stop();
        if (base64) await sendRecordingPayload(action.taskId, base64);
        else
          sendAssistant({
            type: "desktop_agent.event",
            taskId: action.taskId,
            eventType: "evidence",
            detail: "Native screen recording captured.",
            result: {
              summary: "Native screen recording captured.",
              evidence: [{ kind: "recording", title: "Native screen recording" }],
            },
          });
      } else if (action.kind === "focus_window") {
        if (action.target) {
          const result = await focusNativeWindowByTitle(String(action.target));
          if (!result.focused) throw new Error(`No visible window matched "${action.target}".`);
        } else {
          const { getActiveWindow } = await import("@nut-tree/nut-js");
          await (await getActiveWindow()).focus();
        }
      } else if (action.kind === "capture_screen" || action.kind === "read_page") {
        const evidence = await inspectNativeDesktop({
          platform: process.platform,
          userDataPath: app.getPath("userData"),
          sessionType: process.env.XDG_SESSION_TYPE,
          preferVision: task.executionMode === "visual_ocr",
        });
        sendAssistant({
          type: "desktop_agent.event",
          taskId: action.taskId,
          eventType: "evidence",
          detail: evidence.ocrText,
          result: {
            summary: evidence.ocrText,
            evidence: [{ kind: "window", title: evidence.windowTitle, excerpt: evidence.controls.map((control) => control.title).join("; ") }],
            screenshotBase64: evidence.screenshotBase64,
            screenshotMimeType: evidence.screenshotMimeType,
          },
        });
      } else {
        throw new Error("This native action is unavailable in the selected execution mode.");
      }
    } else {
      if (!browser) throw new Error("The task browser is unavailable.");
    if (action.kind === "navigate") {
      const targetUrl = String(action.targetUrl ?? "");
      if (!/^https?:$/i.test(new URL(targetUrl).protocol))
        throw new Error("只允许导航到 HTTP(S) 地址。");
      const target = new URL(targetUrl);
      if (target.username || target.password) {
        throw new Error("Credential-bearing URLs are not allowed.");
      }
      await browser.loadURL(target.toString());
    } else if (action.kind === "scroll") {
      await browser.webContents.executeJavaScript(
        `window.scrollTo({ top: ${Number(action.top) || 0}, behavior: 'instant' })`,
      );
    } else if (action.kind === "read_page") {
      const page = await readEmbeddedPage(browser);
      sendAssistant({
        type: "desktop_agent.event",
        taskId: action.taskId,
        eventType: "page",
        detail: "已读取页面",
        result: { page },
      });
    } else if (action.kind === "capture_screen") {
      const screenshotBase64 = (await browser.webContents.capturePage())
        .toJPEG(76)
        .toString("base64");
      sendAssistant({
        type: "desktop_agent.event",
        taskId: action.taskId,
        eventType: "page",
        detail: "已捕获屏幕",
        result: { screenshotBase64 },
      });
    } else if (action.kind === "click") {
      const selector = JSON.stringify(String(action.target ?? ""));
      await browser.webContents.executeJavaScript(
        `(() => { const element = document.querySelector(${selector}); if (!(element instanceof HTMLElement)) throw new Error('点击目标不存在。'); element.click(); })()`,
      );
    } else if (action.kind === "type") {
      const selector = JSON.stringify(String(action.target ?? ""));
      const value = JSON.stringify(action.value ?? "");
      await browser.webContents.executeJavaScript(
        `(() => { const element = document.querySelector(${selector}); if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error('Fill target not found.'); const hints = [element instanceof HTMLInputElement ? element.type : '', element.name, element.id, element.getAttribute('autocomplete'), element.getAttribute('aria-label'), element.getAttribute('placeholder')].filter(Boolean).join(' ').toLowerCase().replace(/[\\s_]+/g, '-'); if ((element instanceof HTMLInputElement && element.type.toLowerCase() === 'password') || /password|passcode|one-time-code|otp|verification-code|auth-code|mfa/.test(hints)) throw new Error('Credentials and verification fields cannot be filled by the desktop Agent.'); element.value = ${value}; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); })()`,
      );
    } else {
      throw new Error("该桌面动作暂未实现。");
    }
    }
    sendAssistant({
      type: "desktop_agent.event",
      taskId: action.taskId,
      eventType: "progress",
      progress: 80,
      detail: `已完成 ${action.kind}`,
      ...(action.approvalId ? { approvalId: action.approvalId } : {}),
      action: { ...action, approvalToken: action.approvalToken },
    });
    const pending = desktopAgentPlans.get(action.taskId);
    if (pending?.[0]?.requestId === action.requestId) pending.shift();
    await continueDesktopAgentPlan(action.taskId);
  } catch (error) {
    sendAssistant({
      type: "desktop_agent.event",
      taskId: action.taskId,
      eventType: "failed",
      detail: error instanceof Error ? error.message : "桌面动作失败",
      ...(action.approvalId ? { approvalId: action.approvalId } : {}),
      action: { ...action, approvalToken: action.approvalToken },
    });
    finishDesktopAgentTask(action.taskId);
  }
}

function isPrivateDesktopHost(value: string) {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  )
    return true;
  if (
    hostname === "::1" ||
    hostname.startsWith("127.") ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname)
  )
    return true;
  const private172 = hostname.match(/^172\.(\d{1,3})\./);
  return Boolean(
    (private172 &&
      Number(private172[1]) >= 16 &&
      Number(private172[1]) <= 31) ||
      /^(fc|fd|fe80):/i.test(hostname),
  );
}

function isAllowedDesktopDestination(
  url: URL,
  start: URL,
  followExternal: boolean,
) {
  const sameHost = url.hostname.toLowerCase() === start.hostname.toLowerCase();
  return sameHost || (followExternal && !isPrivateDesktopHost(url.hostname));
}

function isCredentialField(action: any) {
  const fieldType = String(action?.fieldType ?? "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return /password|passcode|one-time-code|otp|verification-code|auth-code|\bmfa\b/.test(
    fieldType,
  );
}

function desktopActionNeedsApproval(action: any) {
  return (
    [
      "upload",
      "download",
      "publish",
      "purchase",
      "payment",
      "authorize",
      "submit",
    ].includes(action?.kind) ||
    action?.kind === "fill" ||
    action?.sideEffect === true ||
    action?.kind === "click"
  );
}

function websiteActionReceipt(action: any) {
  const receipt = { ...action };
  delete receipt.value;
  return receipt;
}

async function executeDesktopAction(message: any) {
  const browser = desktopTaskTabs.get(String(message.taskId ?? ""));
  const action = message.action;
  if (
    !browser ||
    browser.isDestroyed() ||
    !action ||
    isCredentialField(action) ||
    (desktopActionNeedsApproval(action) && !message.approvalToken)
  ) {
    if (message.actionId)
      sendAssistant({
        type: "website_capture.action_result",
        actionId: message.actionId,
        taskId: message.taskId,
        approvalToken: message.approvalToken,
        action: websiteActionReceipt(action),
        ok: false,
        message: "桌面端禁止执行凭据字段动作。",
      });
    return;
  }
  let ok = false;
  let resultMessage = "动作未执行";
  try {
    if (
      action.kind === "navigate" &&
      /^https?:$/i.test(new URL(String(action.targetUrl)).protocol)
    ) {
      await browser.loadURL(String(action.targetUrl));
      ok = true;
      resultMessage = "已导航";
    } else if (action.kind === "scroll") {
      await browser.webContents.executeJavaScript(
        `window.scrollTo({ top: ${Number(action.top) || 0}, behavior: 'instant' })`,
      );
      ok = true;
      resultMessage = "已滚动";
    } else if (
      action.kind === "click" &&
      String(action.target ?? "").length <= 500
    ) {
      const selector = JSON.stringify(String(action.target));
      await browser.webContents.executeJavaScript(
        `(() => { const element = document.querySelector(${selector}); if (!(element instanceof HTMLElement)) throw new Error('点击目标不存在。'); element.click(); })()`,
      );
      ok = true;
      resultMessage = "已点击";
    } else if (
      action.kind === "fill" &&
      String(action.target ?? "").length <= 500 &&
      typeof action.value === "string"
    ) {
      const selector = JSON.stringify(String(action.target));
      const value = JSON.stringify(action.value);
      await browser.webContents.executeJavaScript(`(() => {
        const element = document.querySelector(${selector});
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error('填写目标不存在。');
        const autocomplete = String(element.getAttribute('autocomplete') || '').toLowerCase().split(/\\s+/);
        const hints = [element instanceof HTMLInputElement ? element.type : '', element.getAttribute('name'), element.id, element.getAttribute('aria-label'), element.getAttribute('placeholder'), ...autocomplete].filter(Boolean).join(' ').toLowerCase().replace(/[\\s_]+/g, '-');
        if ((element instanceof HTMLInputElement && element.type.toLowerCase() === 'password') || autocomplete.some(value => ['current-password', 'new-password', 'one-time-code'].includes(value)) || /password|passcode|one-time-code|otp|verification-code|auth-code|\\bmfa\\b/.test(hints)) throw new Error('密码、OTP 和验证码字段始终禁止自动填写。');
        element.value = ${value};
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      ok = true;
      resultMessage = "已填写";
    } else {
      throw new Error("此动作类型不支持自动执行。");
    }
  } catch (error) {
    resultMessage = error instanceof Error ? error.message : "动作执行失败";
  }
  if (message.actionId)
    sendAssistant({
      type: "website_capture.action_result",
      actionId: message.actionId,
      taskId: message.taskId,
      approvalToken: message.approvalToken,
      action: websiteActionReceipt(action),
      ok,
      message: resultMessage,
    });
}

function connectEmbeddedAssistant(wssUrl: string, code: string) {
  if (assistantSocket?.readyState === 1)
    return { ok: true, message: "已经连接" };
  const endpoint = new URL(wssUrl);
  const localDevelopment =
    endpoint.protocol === "ws:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== "wss:" && !localDevelopment) ||
    endpoint.pathname !== "/api/website-capture/assistant/ws" ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error("只允许连接 Helstera 的 WSS 助手地址。");
  endpoint.search = "";
  endpoint.hash = "";
  const Socket = (globalThis as typeof globalThis & { WebSocket?: any })
    .WebSocket;
  if (!Socket) throw new Error("当前 Electron 运行时不支持 WebSocket。");
  const credential = assistantSessionToken
    ? `session_token=${encodeURIComponent(assistantSessionToken)}`
    : `code=${encodeURIComponent(code)}`;
  const separator = endpoint.toString().includes("?") ? "&" : "?";
  assistantSocket = new Socket(
    `${endpoint.toString()}${separator}${credential}`,
  );
  assistantSocket.onopen = () =>
    sendAssistant({
      type: "assistant.ready",
      browser: "Electron Chrome",
      platform: process.platform,
      clientKind: "desktop-app",
    });
  assistantSocket.onmessage = (event: any) => {
    let message: any;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.type === "assistant.connected") {
      if (message.sessionToken)
        assistantSessionToken = String(message.sessionToken);
      assistantConnectionId = String(message.connectionId ?? "");
      publishDesktopMcpTools();
      return;
    }
    if (message.type === "desktop.mcp.call") void runDesktopMcpCall(message);
    if (
      message.type === "desktop.mcp.cancel" &&
      typeof message.requestId === "string"
    )
      desktopMcpCalls.get(message.requestId)?.abort();
    if (message.type === "website_capture.start")
      void captureEmbeddedPage(message).catch((error) =>
        sendAssistant({
          type: "website_capture.failed",
          taskId: message.taskId,
          message: error instanceof Error ? error.message : "桌面浏览失败",
        }),
      );
    if (message.type === "website_capture.action_execute")
      void executeDesktopAction(message);
    if (message.type === "desktop_agent.task")
      void runDesktopAgentTask(message.task);
    if (message.type === "desktop_agent.plan_next") {
      void (async () => {
        const taskId = String(message.taskId ?? "");
        const parsedActions = desktopAgentActionSchema.array().safeParse(message.actions ?? []);
        const round = Number(message.round ?? 0);
        if (desktopAgentTasks.has(taskId) && parsedActions.success && parsedActions.data.length > 0) {
          if (round > MAX_NATIVE_AGENT_ROUNDS) {
            await completeDesktopAgentTask(taskId);
            return;
          }
          desktopAgentRounds.set(taskId, round);
          desktopAgentPlans.set(taskId, parsedActions.data);
          await continueDesktopAgentPlan(taskId);
        } else if (desktopAgentTasks.has(taskId)) {
          await completeDesktopAgentTask(taskId);
        }
      })();
    }
    if (message.type === "desktop_agent.vision_request") {
      void (async () => {
        const requestId = String(message.requestId ?? "");
        const description = String(message.description ?? "").slice(0, 500);
        if (!requestId) return;
        try {
          const evidence = await inspectNativeDesktop({
            platform: process.platform,
            userDataPath: app.getPath("userData"),
            sessionType: process.env.XDG_SESSION_TYPE,
            preferVision: true,
          });
          sendAssistant({
            type: "desktop_agent.vision_result",
            requestId,
            found: false,
            x: -1,
            y: -1,
            confidence: 0,
            screenshotBase64: evidence.screenshotBase64,
            screenshotMimeType: evidence.screenshotMimeType,
            screenshotWidth: evidence.screenshotWidth,
            screenshotHeight: evidence.screenshotHeight,
          });
        } catch (error) {
          sendAssistant({
            type: "desktop_agent.vision_result",
            requestId,
            found: false,
            x: -1,
            y: -1,
            confidence: 0,
            error: error instanceof Error ? error.message.slice(0, 500) : "screenshot failed",
          });
        }
      })();
    }
    if (message.type === "desktop_agent.action")
      void executeDesktopAgentAction(message.action);
    if (message.type === "desktop_agent.stop") {
      desktopAgentTasks.delete(String(message.taskId ?? ""));
      desktopTaskTabs.delete(String(message.taskId ?? ""));
      sendAssistant({
        type: "desktop_agent.event",
        taskId: message.taskId,
        eventType: "failed",
        detail: String(message.reason ?? "桌面协作任务已停止"),
      });
    }
    if (message.type === "website_capture.stop")
      sendAssistant({
        type: "website_capture.failed",
        taskId: message.taskId,
        message: "用户停止了桌面浏览任务",
      });
  };
  assistantSocket.onclose = () => {
    for (const controller of desktopMcpCalls.values()) controller.abort();
    desktopMcpCalls.clear();
    assistantSocket = null;
    assistantSessionToken = "";
    assistantConnectionId = "";
    desktopTaskTabs.clear();
  };
  return { ok: true, message: "正在连接" };
}

ipcMain.handle("assistant.open-embedded", (_event, url: string) =>
  openEmbeddedBrowser(url),
);
ipcMain.handle(
  "assistant.connect-embedded",
  (_event, input: { wssUrl: string; code: string }) =>
    connectEmbeddedAssistant(input.wssUrl, input.code),
);
ipcMain.handle("assistant.disconnect-embedded", () => {
  sendAssistant({ type: "assistant.disconnect" });
  assistantSocket?.close();
  assistantSocket = null;
  assistantSessionToken = "";
  assistantConnectionId = "";
  for (const controller of desktopMcpCalls.values()) controller.abort();
  desktopMcpCalls.clear();
  desktopTaskTabs.clear();
  return { ok: true };
});
ipcMain.handle("assistant.close-embedded", () => {
  embeddedBrowserWindow?.close();
  embeddedBrowserWindow = null;
  return { ok: true };
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

function createWindow() {
  mainWindowReady = false;
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: join(__dirname, "preload.js"),
    },
    icon: join(__dirname, "../resources/icon.png"),
  });
  const window = mainWindow;
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return { action: "deny" };
    }
    const origin = new URL(desktopWebsiteUrl()).origin;
    if (target.origin === origin) {
      if (!window.isDestroyed()) void window.loadURL(target.toString());
      return { action: "deny" };
    }
    if (target.protocol === "https:" || target.protocol === "http:")
      void shell.openExternal(target.toString());
    return { action: "deny" };
  });

  // Build application menu
  const menu = Menu.buildFromTemplate([
    {
      label: "Helstera",
      submenu: [
        { label: "检查更新…", click: () => void checkForDesktopUpdate() },
        { label: "关于 Helstera", role: "about" },
        { type: "separator" },
        {
          label: "偏好设置…",
          accelerator: "CmdOrCtrl+,",
          click: () => mainWindow?.webContents.send("navigate", "/settings"),
        },
        { type: "separator" },
        { label: "退出", accelerator: "CmdOrCtrl+Q", role: "quit" },
      ],
    },
    {
      label: "文件",
      submenu: [
        {
          label: "新建项目",
          accelerator: "CmdOrCtrl+N",
          click: () => mainWindow?.webContents.send("new-project"),
        },
        { type: "separator" },
        {
          label: "导出画布为 PNG",
          accelerator: "CmdOrCtrl+E",
          click: () => mainWindow?.webContents.send("export-canvas"),
        },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "重做", accelerator: "Shift+CmdOrCtrl+Z", role: "redo" },
        { type: "separator" },
        { label: "剪切", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "复制", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "粘贴", accelerator: "CmdOrCtrl+V", role: "paste" },
        { label: "全选", accelerator: "CmdOrCtrl+A", role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载", accelerator: "CmdOrCtrl+R", role: "reload" },
        {
          label: "强制重新加载",
          accelerator: "Shift+CmdOrCtrl+R",
          role: "forceReload",
        },
        { label: "切换全屏", accelerator: "F11", role: "togglefullscreen" },
        { type: "separator" },
        { label: "放大", accelerator: "CmdOrCtrl+Plus", role: "zoomIn" },
        { label: "缩小", accelerator: "CmdOrCtrl+-", role: "zoomOut" },
        { label: "重置缩放", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", accelerator: "CmdOrCtrl+M", role: "minimize" },
        { label: "关闭", accelerator: "CmdOrCtrl+W", role: "close" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "Helstera 文档",
          click: () => shell.openExternal("https://docs.helstera.com"),
        },
        {
          label: "报告问题",
          click: () => shell.openExternal("https://feedback.helstera.com"),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) {
      mainWindowReady = true;
      window.show();
    }
    void deliverPendingDesktopLoginCallbacks();
  });

  observeMainWindowLifecycle(window, process.platform, () => {
    if (mainWindow === window) {
      mainWindow = null;
      mainWindowReady = false;
    }
  });

  const desktopHome = new URL("/desktop-app/", desktopWebsiteUrl());
  void window.loadURL(desktopHome.toString());
  if (!app.isPackaged && process.env.HELSTERA_DESKTOP_URL)
    window.webContents.openDevTools();
}

function createTray() {
  const iconPath = join(__dirname, "../resources/icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) return;
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    { label: "显示 Helstera", click: () => mainWindow?.show() },
    { type: "separator" },
    {
      label: "新建项目",
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.send("new-project");
      },
    },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]);

  tray.setToolTip("Helstera");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => mainWindow?.show());
}

app.whenReady().then(() => {
  mcpRegistry = new McpRegistry(
    join(app.getPath("userData"), "mcp-registry.json"),
    safeStorage,
  );
  app.setAsDefaultProtocolClient("helstera");
  configureAutoUpdates();
  createWindow();
  const startupAuthUrl = process.argv.find((argument) =>
    argument.startsWith(`${DESKTOP_AUTH_SCHEME}//`),
  );
  if (startupAuthUrl) receiveDesktopLoginUrl(startupAuthUrl);
  if (process.platform !== "linux") {
    createTray();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on("before-quit", () => {
  void mcpRegistry?.closeAll();
  if (updateTimer) clearInterval(updateTimer);
  for (const timer of desktopLoginTimers.values()) clearTimeout(timer);
  desktopLoginTimers.clear();
  pendingDesktopLogins.clear();
  tray?.destroy();
  assistantSocket?.close();
  recorderWindow?.destroy();
  embeddedBrowserWindow?.destroy();
  desktopCallbackServer?.close();
  desktopCallbackServer = null;
  desktopCallbackUrl = "";
});
