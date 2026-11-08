# 录屏重复帧修复

用户反馈上一版录像仍卡顿。上一轮只检查了标称帧率、时长和大于0.5秒的冻结，未检查移动区间相邻帧是否真实变化。上一生产样片12秒、360帧，`mpdecimate` 去重后保留约167帧，标称30fps不能作为平滑运动的证据。

新增真实Chromium回归在滚动页面并故意延迟状态检查后，解码最终视频检查移动区间的逐帧像素变化：旧实现50个移动帧中42个发生变化，84%，测试失败。新的逐帧采集在同样条件下100/100帧变化，连续重复帧0，测试通过。

页面录制改为固定时间点推进GSAP滚动，逐帧截图后交给编码器，采用60fps。服务器负载影响生成等待，不通过跳帧压缩工作。片段拼接改为复制编码流，去掉重采样和复制补帧；移除片尾快速反向滚动。马赛克、登录状态、审批、取消和结果回写仍复用现有链路。

## 已运行检查

- `frame-continuity.integration.test.ts`：修改前失败，修改后通过；证据 `M:/loomic-builds/frame-continuity-before/` 与 `frame-continuity-final/`。
- 窗口滚动、内部容器滚动、马赛克共3项通过；多光标演示及加载准备共4项通过。
- Shared构建、Server类型检查通过。Windows测试的媒体工具路径支持显式环境配置，隔离检出无需复制安装包资源。

## 生产重录与播放

`f14eda5` 已部署并生成任务 `4c2b3842-2d0e-441f-a0c1-80e673e43831`，产物 `6b02cba1-ae66-45c3-a9cc-167bec7ce0d4`。12秒、1280×720、720帧全部解码通过。在相同12%–68%移动区间，旧片202帧中114帧变化（56.436%）、最长重复3帧；新片404帧中403帧变化（99.752%）、最长重复1帧。此指标用于该滚动样片，不代表任意动画网页都已逐帧验收。

生产画布中完整播放新片，`getVideoPlaybackQuality()` 返回 `totalVideoFrames=724`（含预加载呈现）、`droppedVideoFrames=0`、`ended=true`。证据：`M:/loomic-builds/frame-continuity-final/production-comparison.json`、`production-playback.json`、`production-decode.log`。生成12秒样片约耗时2分钟；逐帧渲染增加生成等待，不是实时录屏。

`f14eda5` 的 Website Capture CI `42447379184`、Agent Closure CI `42447379198`、Desktop Candidate CI `42447379182` 全部成功，包括Windows、macOS、Linux构建。这些是该提交的结果；下述编码预算修改需要独立检查。

## 编码大小预算

60fps无约束质量模式的生产样片约10.8 MB/12秒，长录像可能超过40 MiB上传限制。新增真实编码回归使用持续变化的720p噪声帧；旧编码器6秒产生233,637,911字节，测试失败。改为3 Mbps目标的恒定码率控制，禁止主动丢帧，每2秒生成关键帧，片段拼接继续复制编码流。

一分钟完整压力测试产生29,265,239字节（低于40 MiB），3600帧完整解码。相同运行中的连续性、嵌套滚动、马赛克及演示测试合计9项全部通过，Server类型检查通过。证据：`M:/loomic-builds/frame-continuity-budget-final.log`、`frame-continuity-budget-final/encoding-budget.json`、`frame-continuity-budget-final/frame-continuity.json`。短时压力回归已纳入CI。码率控制会让高复杂度画面的压缩更明显，需同时检查生产页面文字清晰度和播放。

工作在M盘隔离检出执行，D盘原工作区未提交改动、安装包、缓存均保留。

## 加载页阻断

多页生产验收发现，后续页面仍显示整页加载遮罩时也会开始录制。新增应用就绪检查：等待覆盖主要视区的加载状态或 `aria-busy` 消失，15秒后仍未就绪则明确报错；小型加载部件不阻断正常页面。检查不依赖网络空闲来推断应用已完成初始化。

新增真实Chromium用例在旧实现下2项失败，修复后延迟就绪、持续加载、小型异步部件及连续性/马赛克共7项通过，Server类型检查通过。证据：`M:/loomic-builds/frame-readiness-before.log`、`frame-readiness-final.log`、`frame-readiness-types.log`。

编码预算提交 `aa88c53` 的 Website Capture CI `42448479706`、Agent Closure CI `42448479783`、Desktop Candidate CI `42448479707` 全部成功。
