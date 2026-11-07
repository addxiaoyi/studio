# 多光标网站介绍与同步录制

在 Agent 浏览器侧栏展开“网站介绍演示与录制”，填写公开网址，选择 12/24/36/60 秒与 2/4/6 个光标。点击“查看录制方案”后，确认绑定网址、时长、光标数量的录制请求；拒绝不创建作业，确认后后台录制、回存素材库并回写当前聊天。任务状态保存在本机，刷新使用原任务，不重复录制。

Agent 对话的 `website_capture` 也支持 `presentation: {style:"cursor-rebuild", durationSeconds:24, cursorCount:4}`，必须使用隔离模式、开启录制，最多 3 页。此功能不调用付费图像或视频生成模型。

## 效果与边界

原创 GSAP 演示器采集网页的可见布局、文本、媒体位置和样式，用多个彩色光标拉出布局框、显示尺寸、逐字输入、扫入图片、对齐参考线和镜头滚动，最后合成为实际网页快照。它是网站介绍动画，不代表 Agent 实际在源网页编辑 DOM。

Chromix 在新的临时页面播放同一动画时间线并同步录制 WebM，分辨率 1280×720。源页面最多取前三屏、120 个图层，最长 60 秒；当前输出无音轨。动画页面禁止网络请求，不导入源网页脚本、事件处理或 HTML。输入框、密码及可编辑区域不读取值，快照用中性填充遮挡这些区域。

参考仓库 `DhvanilPatel/swarm-cursors` 无复用许可且其 README 提及上游 Swarm 的许可问题，因此只参考效果，不复制其代码或素材。GSAP 固定为现有的 3.13.0，保留包内版权和许可链接。Chromix 沿用之前验证的低权限进程和 Chromium 沙箱。

## 验证

- 真 Chromium 渲染并生成非空 WebM，FFmpeg 完整解码通过；截图证明中间状态有多光标与逐字重建，最终还原原网页。
- 表单值变更前后的遮挡快照一致，视觉层数据不含输入值。
- Shared 参数测试拒绝非隔离模式、未录制、超页数/时长/光标数量。
- 27 项服务端定向测试通过：真实 PostgreSQL 并发消费、过期/拒绝、修改录制参数无效、任务幂等。原在线普通录屏测试因未指定外网验收开关跳过；本轮录制功能用独立真实浏览器链路验证。
- Web 真实浏览器与 PostgreSQL 联合流程通过：拒绝时作业为 0；确认后仅 1 个作业、1 个视频资产、1 条聊天结果；视频播放时间推进、下载成功、刷新不新增作业。
- Windows 正式候选在隔离用户目录运行相同流程，真实 WebM 下载成功；使用 Electron 下载事件核验落盘，不把 Playwright 下载事件替代 Electron 实际行为。
- 本地证据：`.creative-test-results/presentation/`、`presentation-flow/`、`presentation-desktop/` 及相应日志。包含测试视频与截图，不包含生产认证凭据。

## 交付

增量迁移 `20261108000000_website_presentations.sql` 只新增任务的 `presentation` 列。旧录制审批在字段为空时保持原动作指纹；演示任务额外绑定完整配置。录制审批与新任务、原聊天结果和素材接口共用，参数变更需重新审批。

部署前比对生产源文件、无在途媒体任务、磁盘空间，核验上传文件哈希；增加固定 GSAP 浏览器运行时，在真实 Chromix 中运行演示探针。发布与线上实际录像证据随后追加。

线上首次录制发现网页懒加载区块尚未触发，导致后段空白。采集阶段已增加字体就绪等待、逐屏滚动预热，并按实际文本/媒体范围裁剪底部空白；动画结束回到页面顶部。新增懒加载真实浏览器回归先失败后通过，演示与录制测试共 2 项通过。Web 候选 `full-web-B27eup` 已部署，生产 Chromix 155.0.8059.39 探针显示 4 个光标并生成截图。

第二次线上录像发现 24 秒动画被后台检查和帧采集拉长至 49.8 秒。录制器改用实际经过时间推进 GSAP，仅扣除用户明确暂停的时间，并关闭 GSAP 的滞后平滑。真实浏览器回归每次检查加入 150ms 延迟，验证 12 秒演示的 WebM 不超过 17 秒且完整解码通过；观察器、懒加载与录像共 4 项通过，Server 类型检查通过。日志：`.creative-test-results/presentation-clock-tests.log`、`presentation-server-types.log`。

提交 `34815d3b` 的 CI `42390237596` 两个作业全部成功，涵盖四包类型检查、数据库审批、真实浏览器观察和网站演示录制播放。计时修复另行提交并检查对应 CI。

计时修复后线上文件实测 26.92 秒（含启动和收尾），逐帧检查仍发现异步初始化和长页面稀疏内容造成空白。新增两项回归先失败复现：延迟 3.5 秒的异步页面初始化、带大间隔的长页面在重建中段看不到内容。采集现在等待页面 load（最多 8 秒，超时明确记录并采集已有公开内容），演示源页面使用 reduced-motion；镜头改为跟随正在重建的图层，而非按整页长度匀速滚动。含真实 WebM 解码与时长的 4 项回归通过，证据见 `presentation-content-before.log` 与 `presentation-content-after.log`。

## 生产验收完成

2026-11-08，代码提交 `99ad6e6002a098cbeb23714d0a72ab4eadc70138` 已推送并部署。服务端增量替换前逐文件验证旧版本和上传哈希，Server、Worker 重启后均为 online，`/api/health` 返回 `ok:true`。Web 使用已核验的 `full-web-B27eup`，本次后续修正仅涉及服务端。

- 从原画布侧栏实际确认 `https://studio.0st.top/`、24 秒、4 光标。最终任务 `e988742d-7d9a-454a-82a2-3fb1f003a66f` succeeded，执行次数 1、视频素材 1、聊天结果 1；刷新后重新查询仍为相同任务和计数，生成积分未扣除。
- 通过网页下载最终 WebM，1280×720、25 fps、28.08 秒（含启动和收尾）；FFmpeg 完整解码 702 帧，exit 0。抽查第 6/12/18/26 秒，布局与文字逐步出现、图片展开、光标和参考线可见，最后回到完整首屏。当前没有音轨。
- 刷新画布后恢复同一录像，真实播放从 1.0474 秒推进到 20.5985 秒，尺寸和时长保持一致。聊天新增的录像链接指向同一保存结果。
- 最终文件 `.creative-test-results/presentation-production-final.webm`，SHA-256 `f8e910cedc8ac295eea49e997d08f7409e9769407bfd9b5fa53a46b8deb68c22`。截图 `presentation-production-playback.jpg`、`presentation-final-frame-01.png` 至 `04.png`；机器可读证据 `presentation-production-acceptance.json`。
- GitHub [Agent Closure CI 42391720629](https://github.com/addxiaoyi/studio/actions/runs/42391720629) 与 [Website Capture CI 42391720592](https://github.com/addxiaoyi/studio/actions/runs/42391720592) 成功。前者包含类型、数据库、真实 Chromium 录制播放与刷新恢复；Windows Electron 的本地真实候选流程见前述 `presentation-desktop.json`。
- [Desktop Candidate CI 42391720574](https://github.com/addxiaoyi/studio/actions/runs/42391720574) 四个作业全部成功：Windows 视频工具、Windows x64、macOS arm64、Linux x64。包含原生辅助程序、sandbox preload/renderer 回归及候选打包。CI 打包与本地 Electron 流程分别记录，未将候选构建当作用户机器安装验收。

格式解码与画面分别验收：本轮实际抽帧后修复了两次线上发现的问题。现有任务、用户素材、缓存及其他未提交改动均保留。
