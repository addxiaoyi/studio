# 生产稳定性阶段验收（2026-11-10）

本阶段属于九项全局升级的第一项。其他八项仍未完成，不能将此报告当作整体交付。

## 已验证

- 保留策略先预览再按文件身份核对。清理 38 个旧静态归档/安装包，解除路径引用合计 16,269,767,720 字节，释放独占文件内容 13,886,262,007 字节。业务盘可用空间从 1,282,785,280 增至 15,169,118,208 字节，使用率 99%→81%。
- 最近两份静态归档完整读取通过；五个当前安装包清理前后 SHA-256 一致。保留 0.2.27/28 升级验收安装器及 0.2.29/30；未删除数据库、用户素材或浏览器。
- readiness 实测数据库查询、写盘/fsync/删除与接单状态；数据库或磁盘失败返回 503，liveness 独立。相同在途探测共享，超时不无限堆积底层操作。
- 队列空轮询真正等待；四类队列独立调度；停止后不执行迟到查询返回的消息。后台维护、Agent 步骤、流式对话结算、桌面回执和数据库连接按顺序退出。
- 新实例不再全局标记桌面连接断开；原连接完成任务后再关闭。测试中的已消费审批在中断后持久化为 review/paused，不自动重做。
- 共用媒体资源租约覆盖隔离浏览、转写、工作流剪辑/合成/抽帧。每台主机同一磁盘限一项重媒体工作，准入时核对逻辑空间预留，运行时保留 512 MiB 底线，租约失效触发取消。此为应用内准入控制，不是操作系统磁盘配额。
- 临时录制、浏览器产物和 Python 临时文件使用业务盘 `.media-tmp`。候选进程同时设置 TMPDIR，避免浏览器临时 profile 回到系统盘。
- 真实本地 PostgreSQL：审批拒绝不执行、双 Worker 去重、已消费审批退出持久化、独立数据库连接的媒体资源互斥、低空间拒绝和取消释放均通过。
- 真实 Chromium 访问本站首页，读取标题“Helstera — 企业级 AI 设计工作室”，生成 WebM、FFmpeg 裁剪 MP4，并回流三项素材。测试工程和文件已清理；未调用付费模型。
- 候选实例五个 Agent API：未登录全部 401，实际账号登录后全部 200。接口为 goals、suggestions、memories、connectors、browser/sessions。
- 生产 Nginx 已切至 127.0.0.1:3002，公开 readiness 版本为 `0.0.0-stability-20261110`。切换期间 32 次 HTTP 检测全部 200；旧 WebSocket 47 次、新 WebSocket 7 次 pong，均由探针主动结束。
- 随后补齐迟到取消不报告完成、长工作流不阻塞其他工程的调度回归，再切至 `127.0.0.1:3003`，当前版本为 `0.0.0-stability-20261110-1`。第二次切流 56 次 HTTP 全部 200，切换前后 WS 均保持心跳正常。
- 首次 Worker 发布前后 jobs/goals/runs/desktop/captures 五类在途计数全部为 0；新版 Worker online，旧 API/Worker stopped，PM2 配置已保存。
- 最终 API/Worker 为 `helstera-server-blue`、`helstera-worker-blue`，均 online、restartCount=0；原始与 green 实例均 stopped。第二次排空前后五类在途计数仍全部为 0，公开 readiness 持续正常。
- 将 76 份已关闭的 systemd journal 归档迁到 `/www/helstera/.ops-system-upgrade/journal-archive`，每份比较 SHA-256 并通过 `journalctl --verify` 后才解除系统盘原文件。保留全部日志内容，释放系统盘 1,012,773,144 字节；系统盘可用 3,305,046,016 字节（90%），业务盘可用 14,138,257,408 字节（83%）。journald 现有 8 MB，后续限制 256 MB、保留 14 天、系统盘保留 2 GiB；未清理容器卷、数据库或浏览器。

机器证据：`evidence/system-stability-20261110.json`。本地完整日志位于 `M:/loomic-builds/system-upgrade-*.log`。

## CI 最终结果

代码提交 `92e71309924833b2f510e950722051e91843e7fa` 已推送 `codex/agent-workspace-ci`，以下运行均为 success：

- [Agent Closure CI 42836067402](https://github.com/addxiaoyi/studio/actions/runs/42836067402)：四包类型检查、数据库审批/恢复、资源租约、视频修改/撤销/导出、试穿界面、真实浏览器录制、工作流回归。
- [Website Capture CI 42836067313](https://github.com/addxiaoyi/studio/actions/runs/42836067313)：Chromium 与系统依赖、录制定向回归。
- [Desktop Candidate CI 42836067312](https://github.com/addxiaoyi/studio/actions/runs/42836067312)：Windows、Linux、macOS ARM 和 Intel 构建与安装后工作区/恢复验收全部通过。此次没有发布新的桌面版本，现有 0.2.30 通道保留。

CI 中 AI 计划/试穿 API 注入的流程只证明审批、编辑与恢复逻辑，不代表实际模型质量或供应商结算验收；真实本站浏览录像另有本地 Chromium 与 FFmpeg 证据。

## 发布形态

当前 API 发布目录：`/www/helstera/.releases/stability-20261110-1`（首次目录 `stability-20261110`）。采用生产源码副本加已验证增量补丁，保留公开七牛图集路由、上传根目录及生产依赖。未覆盖生产独有的接线代码。后续发布须从当前实例目录核对差异，不能把旧 `/www/helstera/apps/server/src` 当作正在服务的版本。

迁移仅新增 `20261110000000_media_resource_leases` 表和索引，规范化 SHA-256 为 `49f146e85bf8c6aeca4aa65a0bee6bce8756f75f6cda4fc79ca05a2caa0c3f29`。事务内写入 schema_migrations；再次运行确认不重复应用。

可复用脚本：`scripts/storage-retention.py`、`scripts/switch-server-upstream.py`。切流脚本默认预览，校验目标版本及真实依赖；配置语法/第二次就绪检查失败会恢复原配置。不会以未就绪候选替换线上。

## 验收边界及后续

- 系统盘目前约 3.1 GiB 可用，仍不足以任意并行复制大数据库；后续容量治理需把数据库恢复验证、录制 scratch 和用户原片分别预算。此次未扩容系统盘。
- 当前切流证明短窗口 HTTP/WS 连续性；长时间在途供应商任务和真实桌面任务退出仍需专项验收，不能等同于全部故障恢复场景通过。
- 新版进程已完成一次真实停止/启动并保留健康流量；长时运行与实际付费供应商任务仍属于后续专项，不以短时探针代替。
- 后续继续统一工程、本地工程、长视频代理、统一 Agent、供应商结算、交互规范、创作场景与诊断质量评测。
