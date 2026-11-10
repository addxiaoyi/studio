# 0.2.27：离线原片预览与存储管理

## 功能范围

设置页的“本地工作区与云端副本”新增磁盘可用空间和“管理本地空间与云端副本”。可用空间低于 5 GiB 或卷容量的 5% 时提醒，低于 512 MiB 提示严重不足；已有保存逻辑仍根据实际文件大小和保留空间阻止写满磁盘。

离线快照库和设置页快照详情支持本地图片、视频、音频预览。打开时重新核对本地回执和 SHA-256，随后通过只允许当前工作区的短期媒体地址按范围流式读取，不把大视频读入 renderer 内存、不启动本地 HTTP 服务、不请求云端。视频可播放和跳转；切换工作区、文件改变或授权过期后需要重新打开。画布整体缩略图仍是结构预览，真实媒体在单独的预览区域展示。

按工程清理先扫描当前账户的全部快照引用，列出快照与专属素材；其他工程共用素材保留。确认前重新核对目录、索引和文件哈希。无效快照、超过安全扫描上限、待续传上传、文件变化都会阻止清理；尚未上传的待恢复记录会在清单中说明并一起移除。只删除明确列出的本地文件，云端内容不变。删除是永久的，不用“移动到回收站”掩盖未释放磁盘空间。

主动释放云端副本先核对本地原文件，再核对当前云端 ETag 和长度；逐项显示跨设备影响，用户勾选并确认后才执行。服务端检查真实登录身份、素材所有者、工作区成员和内容校验；先持久化释放请求，再删除字节，失败可由原到期清理任务继续处理。成功后网站、其他设备以及引用原素材的画布不能访问该云端副本，本地文件保留。重新确认恢复会上传本地文件并生成引用新素材的画布；重复请求仍幂等。没有自动批量释放已有素材，也没有把清理和模型费用审批合并。

macOS 当前候选未配置代码签名，更新改为从对应架构清单检查版本并提供 DMG 下载，退出后手动替换应用；保留本地目录和设置。Linux 使用原 AppImage 更新通道。CI 产物新增更新清单和 blockmap，避免只有安装包却缺失更新元数据。

## 已验证

- Desktop 完整测试 187 passed、9 skipped；新增本地流式媒体、磁盘阈值、工程清理、云端释放、手动更新用例通过。Web 7 项存储/快照界面回归通过；Server PostgreSQL 释放权限/确认/校验/重试及恢复幂等回归通过。类型检查和 Web 生产构建通过。
- 真实 Windows 候选包：离线图片读取到实际像素，2 秒测试视频播放并跳转；离线冷启动、快照差异、本地队列、M→D 跨盘迁移、重启恢复全部通过，离线网络请求为 0。通过 UI 确认删除 2 份快照与专属视频，另一工程共用图片保留。
- 生产 UI：云端释放确认前原视频仍可 HEAD 200，确认后 HEAD 404；原文件哈希不变，桌面快照中本地视频仍可播放。重新确认恢复生成画布 `eb802b5b-8e00-4eb1-9c11-36c87f6a5f0e`，视频流式播放通过，共用图片直接复用。测试视频 21,781 字节、SHA-256 `7a06b7a3066db7df4e6fed0c25918fd57da5c811f4fb7a98d12a5debaa984174`。
- 生产本地清理 UI：确认后删除隔离验收工作区中的快照和专属原片，共用图片仍在；云端恢复后的视频仍 HEAD 200。浅色、深色、720×640 窗口 200% 缩放、键盘确认按钮可达、无横向溢出通过。
- Windows 隔离安装器从 0.2.26 升级至 0.2.27，退出码 0，安装内容与正式候选 app.asar 一致；两次启动保留原配置、目录、文件。
- 生产 Server 两个既有文件与前版源码逐字核对后加新路由部署；无数据库迁移，重启前活跃任务 0，健康接口 200。Web 143 文件、780,733 字节增量包校验后原子发布。

## 发布证据

实现提交 `1ddfecd`，分支 `codex/agent-workspace-ci`；`35da679` 仅补充发布后的原生更新通道测试。

- [Desktop Candidate CI 42788166037](https://github.com/addxiaoyi/studio/actions/runs/42788166037)：Windows、macOS arm64、Linux x64 全部成功。macOS/Linux 的实际安装包均完成图片真实预览、视频播放与跳转、离线冷启动、目录迁移、明确确认清理和共用素材保留。
- [Agent Closure CI 42788166047](https://github.com/addxiaoyi/studio/actions/runs/42788166047)：类型/数据库组与完整真实浏览器组成功。
- [Website Capture CI 42788165997](https://github.com/addxiaoyi/studio/actions/runs/42788165997)：成功。

候选包：Windows 安装版 95,705,488 字节；macOS Apple Silicon DMG 101,392,372 字节（SHA-256 `6fe4d51f2cf5f533a15c3b66adc7e556150aee869f09ecd8ebca940f3f5a30f8`）；Linux x64 AppImage 86,328,149 字节（SHA-256 `97c969de0ed878c6b4ca0c7a2c20f322a92b0a5aacc65489382d430402b4c801`）。未发布未验收的 macOS Intel 构建。

Windows、macOS Apple Silicon、Linux x64 的 0.2.27 已发布到下载页及各自更新通道。Windows 安装版、便携版和更新文件，macOS/Linux 下载文件及更新文件都已完整读回；大小、SHA-256 与候选及发布清单一致，更新清单 SHA-512 一致。

- Windows 安装包 SHA-256：`7f3b0973d94999a2855c9b304ae7c98fb11f88a770e0e58dc80b4580bf9c2547`；便携版 95,568,451 字节，SHA-256 `d124e14b96730cad6f317554f634c82e7721106d79a1c5ef914c7c74f842407c`。
- [原生更新检查 42792145461](https://github.com/addxiaoyi/studio/actions/runs/42792145461)：实际 macOS 应用与 Linux AppImage 读取生产通道后均识别 0.2.27；macOS 返回正确 DMG 链接和手动更新说明，Linux 返回当前已是最新版本。此项验证更新发现与下载内容，不宣称已完成旧版 Linux 原地更新替换或 macOS 签名安装。
- 下载页验收暴露旧页只有 Windows 便携入口且写着 ZIP 解压。`ebe30bc` 增加真实安装版入口、更新安装说明，并按实际大小显示小文件容量。下载/反馈/存储 10 项定向测试、类型与构建通过；网页增量 134 文件、702,373 字节原子发布。真实 Chromium 验证桌面与 360px 窄屏入口可见、无横向溢出。
- 下载页与更新通道的同内容二进制在逐一 SHA-256 核对后共用文件块，释放 283,430,912 字节（约 270.3 MiB）。三个文件地址和内容不变。健康接口 200，匿名 Agent 与上传列表 401；三个平台版本清单均为 0.2.27。

本机证据目录 `M:/loomic-builds/`：`desktop-027-tests.log`、`desktop-027-scoped-tests.log`、`desktop-027-web-tests.log`、`desktop-027-server-tests.log`、`desktop-027-final-native/report.json`、`desktop-027-live/report.json`、`desktop-027-live/*.png`、`desktop-update-acceptance/installed-027.json`、`desktop-027-server-deploy.log`、`desktop-027-web-delta-report.json`、`desktop-027-public-verification.json`、`desktop-027-native-public-verification.json`、`desktop-027-update-{macos,linux}/update/report.json`、`desktop-027-release-dedup.json`、`desktop-027-public-ui/report.json`、`desktop-027-final-health.json`。
