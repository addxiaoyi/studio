# 0.2.28：本地封面、磁盘分析与素材重新关联

## 实现范围

离线快照的素材列表和桌面设置中的快照详情按可见区域生成真实图片缩略图与视频封面。生成使用沙箱窗口读取已校验的本地文件，封面不请求云端；视频取开头约 0.5 秒或短视频四分之一处，最长边不超过 320×180，JPEG 单张上限 256 KiB。后台窗口有 25 秒超时，失败仍可打开原片。

缓存保存到所选工作区的 `Cache/Thumbnails`，按账户和源内容哈希命名，复用相同内容。整个工作区最多 128 MiB、1000 张；30 天未用的封面在下次读取/维护时淘汰，空间不足 512 MiB 时暂停新封面生成。提供清理当前账户预览缓存入口，保留原文件及其他账户缓存。

“管理本地空间与云端副本”以及离线库的工程管理中增加磁盘分类、重复内容校验与定位文件。分类统计 Media、Projects、Exports、Cache 和其他文件；工程按快照与引用素材占用排序。重复扫描仅比对当前账户 Media 与 Exports 中大小相同的文件，以 SHA-256 验证内容。硬链接共享的文件块不算额外副本；统计按逻辑文件长度呈现，并说明该口径。单次最多 25000 文件、20 层目录和 4 GiB 内容校验，可随时停止；上限或不可读文件明确提示，绝不自动删重。

“重新关联原文件”通过原生文件选择器选择改名/移动后的文件，先核对格式、长度、SHA-256，再显示是否复制。当前账户 Media 子目录内的文件仅更新相对位置；工作区外文件经确认复制到 `Media/<account>/Relinked`，保留外部原片。确认时再次检查文件与索引，拒绝变化、越权账户路径、非法标识、目录穿越及符号链接。后续离线播放、跨盘复制、保存跳过和恢复上传都使用更新后的回执。

本轮没有新增模型调用、云端后台扫描、数据库迁移或 Server 变更。macOS Intel 构建在 GitHub 官方 `macos-15-intel` 运行器上执行，安装包按真实 CPU 架构挂载和启动；继续使用已实现的 DMG 手动替换更新说明。

## 当前验收

- Desktop 190 passed、9 skipped；Web 存储、快照、磁盘与关联 9 项测试通过；Desktop/Web 类型检查和 Web 生产构建通过。
- 完整测试发现旧 HTTP 续传用例固定 30 毫秒断线在繁忙机器上会先于写入；现等首个 65536 字节分片实际落盘后断线，原 `Range: bytes=65536-` 与完整文件断言保持不变。
- 真实 Windows 客户端生成图片缩略图、视频封面，第二次调用命中缓存；本地改名后不复制关联，外部移动后明确确认才复制。关联后视频可播放，重启可重新生成已清理封面；原片保留，离线操作网络请求为 0。
- 真实生产网页配合候选桌面端：视频封面、改名确认、播放、内容重复统计、缓存清理、深浅主题和 200% 缩放下键盘定位均通过。素材上传等云端写入请求为 0。
- Windows 隔离安装器 0.2.27→0.2.28 退出码 0；安装包 payload 与候选一致，两次启动保留工作区、原文件和设置。安装后的程序再次通过完整封面/统计/关联回归，所有本地操作云端请求仍为 0。
- 首次真实测试发现封面错误异步返回会覆盖关联确认文本，已把封面状态与关联确认分开；修复后的完整流程通过。
- Web 142 文件、738744 字节增量包原子发布，公网变动文件哈希验证通过。

## 发布证据

实现提交 `d220b93`；补充素材标识校验 `d3ac125`。

- [Desktop Candidate CI 42798970397](https://github.com/addxiaoyi/studio/actions/runs/42798970397)：Windows、macOS arm64、macOS x64、Linux x64 全部通过。下载并核对原生报告，Intel Mac 的报告明确为 darwin/x64，DMG 安装后的真实运行通过所有新增封面/缓存/关联检查。
- `42798019674` 和 `42798019710` 是前一提交的重复运行，在最新校验启动后取消以避免重复占用 CI 资源；不将取消的运行作为成功证据。

- [Agent Closure CI 42798970479](https://github.com/addxiaoyi/studio/actions/runs/42798970479)：类型、数据库及完整真实浏览器组成功。
- `c232885` 保留旧桌面端无封面接口时的原文件预览提示，定向组件测试和生产构建通过；兼容网页增量包 132 文件、679085 字节原子发布。

Windows 0.2.28 已发布，安装版 95,713,671 字节、便携版 95,575,400 字节；下载页和更新通道三个文件完整读回 SHA-256 与候选一致，更新清单 SHA-512 一致。安装版 SHA-256 `1af10fbd247d34ab5904aa1c930530a448b8e25bb0dd4a5f166da5530fa5f051`，便携版 SHA-256 `63129ffcb990ed860bac76f2c0c9a0407cbc72746ea1458cd0fa83fbeda865ad`。

原生候选：macOS Intel DMG 104,969,002 字节，SHA-256 `2f00d340113682d9dee8624eb6bfa45d10b7de8412d25c9615a765c688e3a993`；Apple Silicon DMG 101,441,277 字节，SHA-256 `9fb138e5c4ae0760fe1c1104677d4e7f71bbcdfc5661f70fbc9719e94a79ff41`；Linux AppImage 86,336,347 字节，SHA-256 `38a11b6433ca9a1f3d266ad656c03907ee742dd2e5dde4e3dd0f9fd4df2be622`。

四个平台 0.2.28 均已发布。Intel、Apple Silicon、Linux 的公开下载和更新文件都已完整读回，与候选 SHA-256 和更新清单 SHA-512 一致。

[发布后原生更新检查 42803355387](https://github.com/addxiaoyi/studio/actions/runs/42803355387)：Linux、Apple Silicon、Intel 全部通过实际安装包检查，当前返回 0.2.28；Intel 应用返回正确的 `Helstera-0.2.28-macOS-x64.dmg` 下载地址。macOS 未配置签名，继续通过正确架构的 DMG 手动替换，不宣称完成签名/公证或系统自动替换验收。

真实 Chromium 验证下载页同时显示 Windows 安装版/便携版、macOS Apple Silicon、macOS Intel、Linux AppImage 的 0.2.28 入口，360px 窄屏无横向溢出。生产健康接口 200，匿名 Agent/上传列表 401，四个平台版本清单都是 0.2.28。

原生包发布时同一安装文件只传输一次，校验后让下载地址与更新地址共用文件块。没有把硬链接重复文件长度当作已释放物理空间；最终去重核验报告记录本次额外释放为 0 字节。

证据保存在 `M:/loomic-builds/`：`desktop-028-first.log`、`desktop-028-foundation.log`、`desktop-028-tests.log`、`desktop-028-web-tests.log`、`desktop-028-insights-final/report.json`、`desktop-028-insights-final/*.png`、`desktop-028-live-final/report.json`、`desktop-028-live-final/*.png`、`desktop-028-installed-insights/report.json`、`desktop-update-acceptance/installed-028.json`、`desktop-028-web-delta-report.json`、`desktop-028-public-verification.json`、`desktop-028-native-public-verification.json`、`desktop-028-{intel,arm64,linux}-evidence/insights/report.json`、`desktop-028-update-{intel,arm64,linux}/update/report.json`、`desktop-028-public-ui/report.json`、`desktop-028-final-health.json`。
