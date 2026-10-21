import { app, BrowserWindow, Menu, Tray, shell, nativeImage, ipcMain } from "electron";
import { join } from "path";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let embeddedBrowserWindow: BrowserWindow | null = null;
let recorderWindow: BrowserWindow | null = null;
let assistantSocket: any = null;
let assistantSessionToken = "";
const desktopTaskTabs = new Map<string, BrowserWindow>();

function isSafeBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function openEmbeddedBrowser(value: string) {
  if (!isSafeBrowserUrl(value)) throw new Error("仅允许打开 HTTP(S) 网站地址。");
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
    embeddedBrowserWindow.on("closed", () => { embeddedBrowserWindow = null; });
  }
  await embeddedBrowserWindow.loadURL(value);
  embeddedBrowserWindow.show();
  embeddedBrowserWindow.focus();
  return { ok: true };
}

function sendAssistant(message: Record<string, unknown>) {
  if (assistantSocket?.readyState === 1) assistantSocket.send(JSON.stringify(message));
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
  recorderWindow.on("closed", () => { recorderWindow = null; });
  await recorderWindow.loadURL("data:text/html,<canvas id=canvas width=1280 height=720></canvas>");
  return recorderWindow;
}

async function startDesktopRecording(browser: BrowserWindow) {
  const recorder = await ensureRecorderWindow();
  recorder.webContents.send("recorder.start");
  let busy = false;
  const timer = setInterval(() => {
    if (busy || recorder.isDestroyed() || browser.isDestroyed()) return;
    busy = true;
    void browser.webContents.capturePage()
      .then((image) => {
        if (!recorder.isDestroyed()) recorder.webContents.send("recorder.frame", image.toJPEG(70).toString("base64"));
      })
      .catch(() => undefined)
      .finally(() => { busy = false; });
  }, 200);
  return { recorder, timer };
}

async function stopDesktopRecording(active: { recorder: BrowserWindow; timer: ReturnType<typeof setInterval> }) {
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
  if (!browser || browser.isDestroyed()) throw new Error("桌面内嵌浏览器未打开。");
  desktopTaskTabs.set(String(task.taskId), browser);
  const recording = task.recordVideo ? await startDesktopRecording(browser) : null;
  let recordingBase64: string | null = null;
  const startUrl = new URL(String(task.startUrl));
  const queue = [startUrl.toString()];
  const visited = new Set<string>();
  let recordingStopped = false;
  try {
    while (queue.length && visited.size < Number(task.pageLimit) && !browser.isDestroyed()) {
    const next = queue.shift();
    if (!next || visited.has(next)) continue;
    visited.add(next);
    if (browser.webContents.getURL() !== next) await browser.loadURL(next);
    const loadedUrl = new URL(browser.webContents.getURL() || next);
    if (!isAllowedDesktopDestination(loadedUrl, startUrl, Boolean(task.followExternal))) throw new Error("自动跟链或重定向扩展到了未授权的本地地址。");
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
    sendAssistant({ type: "website_capture.page", taskId: task.taskId, page, screenshotBase64 });
    sendAssistant({ type: "website_capture.progress", taskId: task.taskId, progress: 10 + Math.round((visited.size / Number(task.pageLimit)) * 70), stage: "page_loading", detail: `已读取 ${visited.size}/${task.pageLimit} 个页面` });
    for (const link of Array.isArray(page.links) ? page.links : []) {
      try {
        const linkUrl = new URL(String(link));
        if ((Boolean(task.followExternal) || linkUrl.hostname.toLowerCase() === startUrl.hostname.toLowerCase()) && isAllowedDesktopDestination(linkUrl, startUrl, Boolean(task.followExternal)) && !visited.has(linkUrl.toString()) && !queue.includes(linkUrl.toString())) queue.push(linkUrl.toString());
      } catch { /* malformed links are ignored */ }
      if (queue.length >= Number(task.pageLimit) * 3) break;
    }
    }
    if (recording) {
      recordingBase64 = await stopDesktopRecording(recording);
      recordingStopped = true;
    }
    if (task.recordVideo && !recordingBase64) sendAssistant({ type: "website_capture.recording_failed", taskId: task.taskId, message: "桌面内嵌浏览器录屏编码失败，已保存页面截图。" });
    sendAssistant({ type: "website_capture.complete", taskId: task.taskId, ...(recordingBase64 ? { recordingBase64: `data:video/webm;base64,${recordingBase64}` } : {}) });
  } finally {
    if (recording && !recordingStopped) await stopDesktopRecording(recording);
    desktopTaskTabs.delete(String(task.taskId));
  }
}

function isPrivateDesktopHost(value: string) {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return true;
  if (hostname === "::1" || hostname.startsWith("127.") || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)) return true;
  const private172 = hostname.match(/^172\.(\d{1,3})\./);
  return Boolean((private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) || /^(fc|fd|fe80):/i.test(hostname));
}

function isAllowedDesktopDestination(url: URL, start: URL, followExternal: boolean) {
  const sameHost = url.hostname.toLowerCase() === start.hostname.toLowerCase();
  return sameHost || (followExternal && !isPrivateDesktopHost(url.hostname));
}

function isCredentialField(action: any) {
  return ["password", "otp", "one-time-code", "verification-code"].includes(String(action?.fieldType ?? "").toLowerCase());
}

function desktopActionNeedsApproval(action: any) {
  return ["upload", "download", "publish", "purchase", "payment", "authorize", "submit"].includes(action?.kind)
    || action?.kind === "fill"
    || action?.sideEffect === true
    || (action?.kind === "click" && !/link|navigation|menu|tab/i.test(String(action?.targetRole ?? "")));
}

async function executeDesktopAction(message: any) {
  const browser = desktopTaskTabs.get(String(message.taskId ?? ""));
  const action = message.action;
  if (!browser || browser.isDestroyed() || !action || isCredentialField(action) || (desktopActionNeedsApproval(action) && !message.approvalToken)) {
    if (message.actionId) sendAssistant({ type: "website_capture.action_result", actionId: message.actionId, taskId: message.taskId, approvalToken: message.approvalToken, action, ok: false, message: "桌面端禁止执行凭据字段动作。" });
    return;
  }
  let ok = false;
  let resultMessage = "动作未执行";
  try {
    if (action.kind === "navigate" && /^https?:$/i.test(new URL(String(action.targetUrl)).protocol)) {
      await browser.loadURL(String(action.targetUrl));
      ok = true;
      resultMessage = "已导航";
    } else if (action.kind === "scroll") {
      await browser.webContents.executeJavaScript(`window.scrollTo({ top: ${Number(action.top) || 0}, behavior: 'instant' })`);
      ok = true;
      resultMessage = "已滚动";
    } else if (action.kind === "click" && String(action.target ?? "").length <= 500) {
      const selector = JSON.stringify(String(action.target));
      await browser.webContents.executeJavaScript(`(() => { const element = document.querySelector(${selector}); if (!(element instanceof HTMLElement)) throw new Error('点击目标不存在。'); element.click(); })()`);
      ok = true;
      resultMessage = "已点击";
    } else if (action.kind === "fill" && String(action.target ?? "").length <= 500 && typeof action.value === "string") {
      const selector = JSON.stringify(String(action.target));
      const value = JSON.stringify(action.value);
      await browser.webContents.executeJavaScript(`(() => { const element = document.querySelector(${selector}); if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error('填写目标不存在。'); element.value = ${value}; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      ok = true;
      resultMessage = "已填写";
    } else {
      throw new Error("此动作类型不支持自动执行。");
    }
  } catch (error) {
    resultMessage = error instanceof Error ? error.message : "动作执行失败";
  }
  if (message.actionId) sendAssistant({ type: "website_capture.action_result", actionId: message.actionId, taskId: message.taskId, approvalToken: message.approvalToken, action, ok, message: resultMessage });
}

function connectEmbeddedAssistant(wssUrl: string, code: string) {
  if (assistantSocket?.readyState === 1) return { ok: true, message: "已经连接" };
  const endpoint = new URL(wssUrl);
  const localDevelopment = endpoint.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if ((endpoint.protocol !== "wss:" && !localDevelopment) || endpoint.pathname !== "/api/website-capture/assistant/ws" || endpoint.username || endpoint.password) throw new Error("只允许连接 Helstera 的 WSS 助手地址。");
  endpoint.search = "";
  endpoint.hash = "";
  const Socket = (globalThis as typeof globalThis & { WebSocket?: any }).WebSocket;
  if (!Socket) throw new Error("当前 Electron 运行时不支持 WebSocket。");
  const credential = assistantSessionToken ? `session_token=${encodeURIComponent(assistantSessionToken)}` : `code=${encodeURIComponent(code)}`;
  const separator = endpoint.toString().includes("?") ? "&" : "?";
  assistantSocket = new Socket(`${endpoint.toString()}${separator}${credential}`);
  assistantSocket.onopen = () => sendAssistant({ type: "assistant.ready", browser: "Electron Chrome", platform: process.platform });
  assistantSocket.onmessage = (event: any) => {
    let message: any;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.type === "assistant.connected") {
      if (message.sessionToken) assistantSessionToken = String(message.sessionToken);
      return;
    }
    if (message.type === "website_capture.start") void captureEmbeddedPage(message).catch((error) => sendAssistant({ type: "website_capture.failed", taskId: message.taskId, message: error instanceof Error ? error.message : "桌面浏览失败" }));
    if (message.type === "website_capture.action_execute") void executeDesktopAction(message);
    if (message.type === "website_capture.stop") sendAssistant({ type: "website_capture.failed", taskId: message.taskId, message: "用户停止了桌面浏览任务" });
  };
  assistantSocket.onclose = () => { assistantSocket = null; assistantSessionToken = ""; desktopTaskTabs.clear(); };
  return { ok: true, message: "正在连接" };
}

ipcMain.handle("assistant.open-embedded", (_event, url: string) => openEmbeddedBrowser(url));
ipcMain.handle("assistant.connect-embedded", (_event, input: { wssUrl: string; code: string }) => connectEmbeddedAssistant(input.wssUrl, input.code));
ipcMain.handle("assistant.disconnect-embedded", () => {
  sendAssistant({ type: "assistant.disconnect" });
  assistantSocket?.close();
  assistantSocket = null;
  assistantSessionToken = "";
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
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: true,
    autoHideMenuBar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
    icon: join(__dirname, "../resources/icon.png"),
  });

  // Build application menu
  const menu = Menu.buildFromTemplate([
    {
      label: "Helstera",
      submenu: [
        { label: "关于 Helstera", role: "about" },
        { type: "separator" },
        {
          label: "偏好设置…",
          accelerator: "CmdOrCtrl+,",
          click: () =>
            mainWindow?.webContents.send("navigate", "/settings"),
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

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (e) => {
    if (process.platform === "darwin") {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Load the web app
  if (!app.isPackaged) {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  }
}

function createTray() {
  const iconPath = join(__dirname, "../resources/icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    { label: "显示 Helstera", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "新建项目", click: () => {
      mainWindow?.show();
      mainWindow?.webContents.send("new-project");
    }},
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]);

  tray.setToolTip("Helstera");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => mainWindow?.show());
}

app.whenReady().then(() => {
  createWindow();
  if (process.platform !== "linux") {
    createTray();
  }
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
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
  tray?.destroy();
  assistantSocket?.close();
  recorderWindow?.destroy();
  embeddedBrowserWindow?.destroy();
});
