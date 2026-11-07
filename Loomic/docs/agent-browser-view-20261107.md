# Agent 隔离浏览器侧栏（2026-11-07）

Web 与 Windows 桌面共用观察侧栏，可从页面右侧、工作区侧栏或浏览任务卡片一键展开。用户能查看当前任务的浏览画面、真实读取位置、网址和执行状态；折叠后任务继续运行，刷新后重新连接。支持任务切换、放大预览、下一动作前暂停和继续。

## 引擎与来源

- 已克隆 Chromix 固定提交 `bf3221bcfa08b652ff62a44f52ccce393ef1d351`，许可证为 BSD-3-Clause，声明保留在 `third-party/chromix-LICENSE.txt`。
- 生产使用经过官方 SHA-256 核验的 Linux x64 `v155.0.8059.39`。浏览器以独立 `loomic-browser` 用户运行，启用 Chromium sandbox，使用每次启动的新临时配置目录；服务端密钥不继承给浏览器进程。
- `swarm-cursors` 固定提交 `3d49e0ac96172eb6af7ae8229b2152121bed2092` 已克隆核对。其 README 明确没有复用许可证，并包含原 Swarm 项目的代码，因此不分发它的代码或素材。本次光标是原创 GSAP 实现，以真实动作坐标驱动，没有播放模拟操作的重建动画。
- 两端查看的是同一个服务端 Chromix 隔离会话。不会自动打开或共享用户电脑上的个人 Chrome 配置，也不将接管任意桌面窗口描述为浏览侧栏能力。

## 权限与生命周期

- 新接口 `/api/agent/browser/sessions`、`/:id/frame`、`/:id/control` 均需登录、当前工作区和会话创建者匹配，并实时检查隔离浏览器连接器权限。
- 预览文件位于私有 `STORAGE_ROOT/agent-browser-views/<session-id>/frame.jpg`，每会话只保留最新一帧。返回 `private, no-store`，不会公开静态文件地址；网址展示去除查询参数和 fragment，密码、验证码与银行卡输入框在预览中遮挡。
- 心跳超过 15 秒显示断线及最后画面。已完成、过期或断线会话无法恢复执行。侧栏网络断开显示最后画面，权限撤销后清除内存预览。
- 暂停只改变观察会话的动作检查点，当前动作结束后停止推进；保持浏览进程和预览可用。15 分钟未恢复则结束等待。现有任务审批、只读请求与私网地址限制仍生效。
- 结束后一小时清理预览。删除文件成功后才删除过期索引，失败可重试；清理范围仅限专用预览目录。

## 构建与配置

`node scripts/prepare-chromix.mjs <win32-x64|linux-x64>` 下载锁定版本并验证哈希；`scripts/agent-browser-sources.json` 固定版本和摘要。浏览器二进制不提交 Git。

启用：

```text
HELSTERA_BROWSER_VIEW_ENABLED=1
HELSTERA_BROWSER_ENGINE=chromix
HELSTERA_CHROMIX_EXECUTABLE_PATH=/absolute/path/to/verified/chromix
```

root 管理的 Linux 服务可使用 `scripts/agent-browser-linux-launcher.py`：按脚本目录安装固定版本，创建专用无登录用户，启动器仅接受 Playwright 临时目录并降权后执行。运行库保留 Chromium sandbox；不自动添加 `--no-sandbox`。已选择 Chromix 而文件未安装时会明确失败，不静默切换引擎。

增量迁移：`apps/server/src/local-db/migrations/20261107000001_agent_browser_views.sql`。

## 已完成验收

- 服务端 44 项定向测试通过：真实 PostgreSQL 的跨用户读取拒绝、鉴权、连接器撤销、暂停/恢复、过期清理，加上真实 Chromium 画面、点击、填写及独立上下文验证；另加浏览进程不继承服务凭据的回归。
- 前端 3 项测试通过：任务关联、折叠不取消、权限撤销清除画面，未启动任务不显示其他任务画面。
- 真浏览器 E2E 通过：真实操作后预览更新、暂停阻止后续动作、刷新恢复、320px、减少动态效果与 Esc 关闭。
- Windows 正式候选 `full-desktop-FFwE5y` 使用隔离用户目录运行同一流程，通过。实测发现标题栏遮挡关闭按钮，已让侧栏避开 46px 原生标题栏；不是仅用网页模拟桌面标识。
- Chromix Linux 原生沙箱探针通过：版本 `155.0.8059.39`，真实页面截图 10,227 字节。部署启动探针确认 `engine: chromix` 并产生非空截图。
- Shared 构建与 Server/Web/Desktop 类型检查通过。独立待提交目录也完成 Shared 构建及 Server/Web 类型检查。

生产 Server/Worker 已应用新表和引擎配置，启动后健康正常，未登录会话接口返回 401。Web 候选 `full-web-y59VQh` 导出 68 页，上线前核验 3,250 个文件摘要。具体线上任务、截图与 GitHub 状态在完成后追加。

线上已登录画布 `356a4a1a-71d5-4d19-a4dd-59a398e236b8` 发起公开网页读取，任务完成并回写标题、介绍和截图。任务卡一键打开对应 Chromix 会话，返回的图片真实解码为 1280×720；刷新画布后仍可再次打开，已完成状态明确标为“最后画面”。截图留在 `.creative-test-results/agent-browser-production.png`。

慢网络回归额外验证：当画面下载耗时超过元数据刷新间隔时，不中断正在下载的帧，完成后再取最新帧，避免持续实时任务在弱网下始终没有首帧。此项先复现失败再修复，前端测试增至 4 项。放大预览限制高度并按实际图像显示宽度计算光标尺寸。

本地证据位于 `.creative-test-results/agent-browser*`；不提交用户登录态、私人截图或下载缓存。Windows 原生 Chromix 归档下载遇到限速，已停止额外下载并保留部分文件；本轮桌面验收覆盖服务端浏览器观察，不声称已验收本机 Chromix 执行器。
