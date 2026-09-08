import { app, BrowserWindow, Menu, Tray, shell, nativeImage } from "electron";
import { join } from "path";
import { is } from "electron-util";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

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
  if (is.development) {
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
});
