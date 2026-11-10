# 0.2.26：本地快照、恢复任务与云端暂存

## 行为与存储边界

桌面用户选择的工作区继续保存 Media 原文件、Projects 画布/对话快照和恢复任务记录。本轮将素材回执改为可迁移的相对路径，并兼容旧绝对路径：重新选择另一块磁盘上的工作区后只读取新目录，不回退到旧盘。恢复前核对账户、文件大小和 SHA-256，拒绝越界路径及符号链接。

“浏览本地快照”和启动恢复页的“离线浏览本地快照”在本机读取结构缩略图、画布文字、历史对话和同工程版本差异，不请求云端。断网可把快照加入本地待恢复列表；联网并登录原账户后，在“恢复与上传任务”中重新预览、确认，再恢复到新画布。

结构缩略图根据快照元素绘制，图片和视频显示占位，不宣称是媒体真实帧预览。单次目录扫描最多 500 份/约 128 MiB，单份快照上限 16 MiB；内容预览最多 200 个元素、50 个文字元素和末尾 80 条消息。完整记录仍在原 JSON 中。此功能是离线浏览和准备恢复，不是完整离线编辑器。

恢复任务保存在当前账户的 `restore-tasks.json`，不写入令牌或密码；界面显示本地待恢复任务与当前账户的云端未完成上传，支持继续前预览和明确确认后清理。重启后的上传任务显示为暂停，清理后仍能从本地原片重新恢复。清理仅删除分片暂存，不删除本地原文件或已完成素材。

云端减压包括：

- 上传列表由用户主动打开/刷新，没有新增后台轮询。
- 恢复前先检查原私有素材是否仍可用，可用则不重复上传；状态检查异常会阻断，避免将服务错误误判成素材丢失。
- 同账户、同工作区、SHA-256/大小/MIME 一致且未到期的私有视频直接复用；缺失实际文件时重新上传。
- 同卷完成上传通过硬链接入库，删除暂存链接后正式素材仍存在，不复制第二份视频数据；跨卷才检查空间后复制。
- 未完成分片 6 小时无进展后到期，每 15 分钟扫描清理；每账户最多 4 个未完成上传、合计 4 GiB，单文件上限 2 GiB。
- 已完成私有素材沿用现有 3 天保留策略；没有自动删除用户已有云端成品。恢复到在线画布仍需网络，付费生成继续逐次确认。本轮没有数据库迁移或付费模型调用。

## 验收结果

- Desktop 单元测试：原完整套件 181 passed、9 skipped；补充的恢复复用回归与原恢复测试 2/2 passed。Web 恢复/快照/上传任务 8/8 passed。PostgreSQL 分片与硬链接存储 3/3 passed。Shared/Server/Web/Desktop 的 CI 类型检查已通过。
- 先用回归复现并修复两处问题：不存在的上传读取请求创建空目录；清理暂存后列表无法继续预览。测试没有弱化原断言。
- 真实 Windows：M 盘工作区复制到 D 盘，故意改变旧盘文件，恢复仍读取新盘校验正确的素材。断网冷启动可进入快照库、看差异和历史对话、加入待恢复队列，离线操作的网络请求为 0；重启保留新目录。
- 真实生产：27,742,218 字节、24 秒 MP4，在 8,388,608 字节暂停。清理确认前暂存仍存在，确认后列表中移除；本地原片 SHA-256 未变。关闭客户端并重启后，从已清理任务重新预览确认，恢复画布并实际播放。相同文件另建上传标识直接返回原素材，上传字节为 0。
- 生产画布：`3d7de490-511d-4401-ae6c-6b2a562fe523`。视频 SHA-256：`d8166050a78ec9f177deece21c1e02632c3730d9f8cb809e3cd228016ed10543`；生产 Content-Length 与 ETag 一致。
- 真实生产界面：浅色/深色、720×640 Windows 窗口下 200% 缩放、键盘打开筛选与预览、确认按钮焦点可达、无页面横向溢出、Esc 关闭通过。未确认不会上传/恢复。
- 隔离安装器从 0.2.25 升级到 0.2.26，退出码 0；安装后 app.asar 与候选完全一致，原设置、工作区、测试文件保留；两次重启通过。安装版再次通过离线冷启动及 M→D 迁移。
- macOS 从 DMG 安装的 Helstera.app、Linux 从 AppImage 解包的实际 Electron 二进制均通过 14 项本地工作区测试，以及离线冷启动、快照差异、本地排队和目录迁移。CI 的迁移发生在同卷；真正跨盘由本机 Windows M→D 验证。macOS/Linux 本轮是候选包验收，未发布到公开下载通道。
- Server 三个变动文件与生产基线核对后部署，重启前活跃任务为 0；健康接口 200，匿名恢复接口 401。Web 211 个变动文件通过哈希校验后原子发布，压缩增量包 1,664,031 字节，保留下载目录。

## 发布与 CI

代码提交 `56e1c1c`，分支 `codex/agent-workspace-ci`。

- [Desktop Candidate CI 42778488679](https://github.com/addxiaoyi/studio/actions/runs/42778488679)：Windows/macOS/Linux 全部成功，含原生包实际启动和离线/工作区回归。
- [Website Capture CI 42778489057](https://github.com/addxiaoyi/studio/actions/runs/42778489057)：成功。
- [Agent Closure CI 42778488925](https://github.com/addxiaoyi/studio/actions/runs/42778488925)：类型、数据库与权限组、完整浏览器组均成功。

Windows 0.2.26 已发布到下载页和自动更新通道。安装包 95,702,733 字节（91.3 MiB），便携包 95,565,508 字节；没有新增大型运行依赖。三个公网二进制均完整读回，大小和 SHA-256 与候选、发布清单一致；`latest.yml` 的 SHA-512 也与实际安装包一致。安装包未配置代码签名。

- 安装包 SHA-256：`4cb7945e065e987c353f5cf557e2ef66b52148121295451a53725aefbf61846f`。
- 便携包 SHA-256：`7c6b7b79ecd0bf94423e077b51441dc5a9d9d23dcfb173e1abaecaaa59498d2f`。

生产源码 SHA-256 与候选一致；健康接口 200，匿名 Agent 会话和分片列表均返回 401。发布后的上传暂存扫描为 0 个分片、0 字节。下载页与更新通道的同内容安装包经两侧完整 SHA-256 检查后改为共用 inode，释放 95,703,040 字节物理块，URL 与文件字节不变。

本机证据：`M:/loomic-builds/desktop-026-tests.log`、`desktop-026-storage-first.log`、`desktop-026-cleared-first.log`、`desktop-026-storage-final.log`、`desktop-026-web-final.log`、`desktop-026-reuse-final.log`、`desktop-026-live/report.json`、`desktop-026-live/*.png`、`desktop-026-installed-offline/report.json`、`desktop-update-acceptance/installed-026.json`、`desktop-026-server-deploy.log`、`desktop-026-web-delta-report.json`、`desktop-026-{windows,macos,linux}-evidence/`、`desktop-026-public-verification.json`、`desktop-026-production-health.json`、`desktop-026-release-dedup.json`。
