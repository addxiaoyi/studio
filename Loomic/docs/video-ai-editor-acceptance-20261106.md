# 当前合成 AI 编辑与 OneTake 验收 — 2026-11-06

本次在现有 `/video/` 工作区整合 AI 编辑与文字剪辑，保持当前合成、私有素材和聊天关联。Git 发布及生产验收状态以本文末尾记录为准。测试产物、模型缓存、安装包和不相关工作区改动不纳入功能提交。

## 已实现行为

- `/api/video/editor/plan` 复用 Agent 模型配置，只接受共享契约校验过的 cut、caption、audio、export。模型调用有 60 秒截止时间，不自动重试推理；迟到响应不保存计划。
- 确认绑定用户、合成、素材版本、计划指纹和完整动作集合。逐项确认后修改当前合成，保留撤销记录；明确指定的音乐、起播时间与音量不得被模型替换。
- IndexedDB v3 保存工程与动作 ID；服务端持久化计划和执行回执。刷新只补同步丢失回执，不重复插入字幕、音乐或导出文件。
- 识别静态 BasicCaptions、导入别名及嵌套 Sequence。动态字幕和无法安全还原的自由变速合成明确拒绝原生导出。
- OneTake 实际转写和剪辑已接入，功能对照见 [OneTake 整合说明](onetake-integration-20261106.md)。
- 桌面 FFmpeg 导出使用位图字幕，经过原生确认与素材目录写入检查。文件保存回执先持久化，再尝试预览和服务端同步。

## 三组独立验收

| 验收 | 实际运行 | 结果与边界 |
| --- | --- | --- |
| 真实模型编辑 | Chromium、密码认证、PostgreSQL、测试 Electron；`openai:grok-4.6`，推理 4132ms | 1 passed，39.1s；模型返回结构化命令并修改 MyComp，导出回执丢失后恢复。此轮原生确认由测试控制。 |
| Windows 候选程序 | `full-desktop-1lBgb1/apps/desktop/release/win-unpacked/Helstera.exe`，独立 userData | 1 passed，193.3s；真实系统文件夹选择器和确认弹窗。拒绝导出目录为空，允许后输出 MP4，回执恢复未重复文件。计划为测试注入。未运行 NSIS 安装过程。 |
| OneTake 全链路 | Chromium、密码认证、独立 PostgreSQL schema、真实 Whisper tiny 与系统 FFmpeg | 1 passed，51.0s；上传、转写、改词删词、撤销重做、审批、播放、私有保存、聊天回写、当前合成替换及刷新幂等恢复。含主题、540px、200% 缩放和键盘操作。 |

报告在本地 `.creative-test-results/`：`video-ai-real-model-20261106.json`、`video-ai-report.json`、`onetake-browser-report.json`。三者均 expected=1、unexpected=0、flaky=0。报告不提交，避免包含临时账号、请求内容或本机目录。

Windows 输出证据 `video-ai-live/.../electron-export.json`：`nativeApproval=native-dialog`、`rejectedBeforeExport=true`、`exportReceiptRecovered=true`。实际 MP4 为 H.264 1280×720、30fps、1.5 秒，AAC 48kHz 双声道。

安装包 `Helstera-Setup-0.2.21-Windows-x64.exe` SHA-256：`B91D72B6F306F408218F77E7D4A40C9C667ECE5AA548603001347B30B500B473`。

## 定向检查

- Shared、Server、Web、Desktop 类型检查通过；最终 Web 类型检查在开发服务器退出后执行。
- Shared OneTake/编辑器契约 12 项，Server 模型及开放配置 9 项，HTTP 禁用模型门禁 1 项，真实 PostgreSQL 生命周期/审批恢复 2 项通过。
- 真实 Whisper + FFmpeg MP4/MOV/AVI 导出集成测试通过；自动字幕字号 Python 2 项，候选打包 4 项通过。
- Web 定向检查 26 项，Desktop 23 项，VisualForge 源码变更 12 项通过。媒体就绪回归修正后，Web 四个相关文件的 8 项测试再次通过。
- 最初测试在文本出现后立即跳转播放位置，早于媒体加载；补充 HAVE_METADATA 和时长就绪检查，保留前进/后退 5 秒断言后，完整测试通过。

## 复跑

在 `apps/web` 中：

```powershell
$env:HELT_ONETAKE_TEST_SOURCE=(Resolve-Path '../../.creative-test-results/onetake-media/speech.mp4').Path
$env:HELSTERA_ONETAKE_PYTHON=(Resolve-Path '../../.creative-test-results/onetake-venv/Scripts/python.exe').Path
node node_modules/@playwright/test/cli.js test --config playwright.onetake.config.ts
```

该测试使用 3217 Web、3312 API，仅创建随机 PostgreSQL schema。AI 配置 `playwright.video-ai.config.ts` 使用 3216/3311；`HELT_TEST_REAL_MODEL=1` 开启真实模型，`HELT_TEST_ELECTRON_PATH` 指定候选 exe。测试不能接管已有服务。

## 发布记录与剩余边界

- 增量迁移：`20261106000000_video_editor_plans.sql`、`20261106000001_video_editor_receipts.sql`、`20261106000002_onetake_jobs.sql`。
- 最新 68 页 Web 候选：`release-candidates/full-web-lmHRHn`；归档 `loomic-onetake-20261106-final.zip` SHA-256：`a7f3ec449e03e5a3dbb70da504fc023a7c9536ae999d2b5ad226a3802214f568`。
- 生产已准备独立 Python 环境、tiny/base 模型与 Noto CJK 字体；正在进行备份恢复演练，尚未记录生产验收完成。
- 桌面 NSIS 安装、macOS/Linux 原生导出未验收。打包 exe 的隔离页面验收也不等于完整首次登录安装流程。
- 客户端成片回执不能证明远端本机磁盘长期可用；写入文件后、持久化回执前崩溃时仍须核验本地导出历史。
