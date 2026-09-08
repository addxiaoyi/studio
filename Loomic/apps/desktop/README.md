# Helstera Desktop

Helstera 的原生桌面应用，基于 Electron 构建。

## 系统要求

- **Windows**: Windows 10 及以上（64-bit）
- **macOS**: macOS 11 Big Sur 及以上
- **Linux**: Ubuntu 20.04+ / Debian 10+（AppImage）

## 开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器（热重载）
pnpm dev

# 构建生产版本
pnpm build
```

## 功能

- 🖥️ 原生 macOS / Windows / Linux 应用
- 📋 菜单栏（文件、编辑、视图、窗口、帮助）
- 🔔 系统托盘（macOS / Windows）
- ⌨️ 键盘快捷键
- 📦 离线可用（需要先联网激活授权）
- 🔄 自动更新

## 技术栈

- Electron 33
- Vite + React
- electron-builder
- electron-updater

## 构建说明

构建前需先生成 macOS 应用图标（.icns）、Windows 图标（.ico）和 Linux 图标（.png），放入 `resources/` 目录。
