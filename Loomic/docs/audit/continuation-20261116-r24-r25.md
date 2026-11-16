# 2026-11-16 r24/r25 production continuation

工作树：`D:/qwq/项目/scpit/.codex-worktrees/Loomic-continuation-20261112/Loomic`；分支：`codex/production-closure-20261115`。已有未提交改动均保留，没有 reset、clean、提交或推送。

## 已上线：公共媒体取消竞态修复

只读审阅与子进程回归发现本地媒体读取的取消竞态：异步文件检查期间收到 abort 后，校验流可能在迭代器接管之前发出未捕获 AbortError。在旧线上代码的独立 Node 20.20.2 探测中，5 次立即取消产生 5 次独立 uncaughtException，进程退出码 1；未向运行中的 PM2 服务注入异常。

实现现在在构造流之前检查取消，使用 pipeline 接管校验流错误，并为交付流显式接管错误。取消仍可被消费者观察，非取消错误会记录安全的 kind/code。新增子进程回归覆盖立即取消、交付流后取消和意外流错误，先失败后修复。生产 Node 20.20.2 对新代码验证 20 次立即取消及交付后取消，uncaught=0。

部署的独立代码包是 `.codex-release/public-media-recovery-20261116-r2.zip`：10,166 字节，SHA-256 `083dd02d06e2dcd1d627e9ea6e01302bfe52ca02e10c1aeb914d461ac2354d20`。生产运行目录 `/www/helstera/.public-media-recovery-20261116-r23/update-r2/runtime`，PM2 名称 `helstera-public-media-recovery-r2`，PID 687859，版本 `public-media-recovery-083dd02d06e2dcd1`。

切换过程先在 3015 验证新服务，再将四个公开媒体路由从 3014 移到 3015；旧服务正常退出后，新修复版本在 3014 启动，四路切回，备用服务正常退出。旧服务、备用服务均 exit 0。PM2 已保存，最终 Nginx 配置字节与本次切换前完全一致。原 API/Worker PID 1027/1030、重启数 0，未改变。

首次预备启动使用的 PM2 配置文件名未被识别为 ecosystem 配置，实际启动了临时配置脚本；切换前健康门禁拦截，流量未改变。已确认该临时进程的脚本路径后移除，并改用独立目录内 `ecosystem.config.cjs` 启动、核验真实服务。另一次手工录入哈希错误也在任何流量变更前被拦截，随后读取并验证原回执继续；没有绕过哈希门禁。

公网原图、缩略图和直接 API 仍通过 SHA、Range 206、ETag 304、非法范围 416、缺失/私有路径 404及匿名受保护接口 401 检查。12 个跨分类文件抽样 SHA 正确。60 次真实 TCP 主动断连后 PID 不变、重启数 0、文件描述符 25→25，readiness 200。原有 2,814 文件全量 SHA 记录保持有效，公共文件及 manifest 本轮未变更；本轮没有声称再次全量下载 2,814 个文件。

主要证据：`.creative-test-results/production-public-cancel-reproduction-r24.json`、`production-public-cancel-fixed-r24.json`、`production-public-cancel-rollout-r24.json`、`production-public-disconnect-postflight-r24.json`、`production-public-final-state-r24.json`。生产事务 journal：恢复目录下 `update-r2/cutover.json`。修复后的路由 apply/rollback 保护并发配置改动，rollback 验证/reload/回执失败时恢复原恢复路由，保持可重试；13 项路由测试通过。

## 完整版本发布准备改进

正常蓝绿工具的旧进程回执门禁保持不变。已完成以下带回归的修复：

- 严格识别四个 3014 公共媒体路由，切换主 API 时逐字保留这些路由；未知附加 upstream 仍拒绝。
- 从实际 API cwd 用 Node `import.meta.resolve` 解析 Shared，验证包名称、完整 dist 入口和部署根路径边界，不执行模块。旧生产真实加载的是 `/www/helstera/.server-runtime/packages/shared/dist`；release 目录内没有独立 Shared。备份及准备采用真实路径，恢复备份须验证 source/web/shared provenance。
- 生产准备改为新目录内的完整候选树，不继承旧源码/Shared 的孤立文件。三个代码树在依赖安装前和报告 PREPARED 前都检查精确文件集合、哈希及无符号链接。占用的 resumed next 会拒绝并保留，避免覆盖或 src/src 嵌套。只读核对旧生产目录确有历史探测源码、备份文件等候选清单外文件。
- 新增 `--prepare-only`，强制隔离数据库恢复演练，成功后保留候选并只报告 PREPARED，在浏览器安装、实时进程和路由切换前返回。与停机发布或清理旧备份选项冲突时提前拒绝。
- 已提交但旧 API 退役失败的事务输出 RETIREMENT_INCOMPLETE，不能继续输出完整 DEPLOYED。
- pnpm store 显式放在候选的数据盘 `next/.pnpm-store`，容量守卫数值未降低。

独立的只读活动检查器 `scripts/legacy-release-activity.mjs` 使用 repeatable-read READ ONLY 事务，核对 8 张允许表的真实字段与聚合状态，不读取用户 payload。15 项 Node 测试通过。生产快照 `.creative-test-results/production-legacy-release-activity-r24.json` 检查 8 表，无执行阻断项；保留 1 个 queued goal step 作为持久待办。旧 agent_runs 没有 owner/lease 字段，覆盖范围明确标为 partial；accepted/running 数均为 0。这不是进程排空回执，也不能代替维护屏障后的复查。

## 生产备份、容量与演练

有效备份目录 `/www/helstera/.helstera-backup.118nPF`。`current.tgz` 包含实际运行源码、静态站点及实际 Shared，约 2.00 GB；生产数据库 dump 1,834,375,751 字节，已生成 SHA 校验文件。备份完成后曾成功恢复到独立、仅 Unix socket 可达的 PostgreSQL 集群，并应用候选 11 项迁移；临时集群正常停止并清理，没有在生产数据库运行这些迁移。

最初的准备调用在运行中遇到本地发布工具源文件更新，后续动态生成容量探针出现 NameError。该次没有接受 PREPARED，staging 被工具清理，已完成备份保留。之后冻结工具并复用已验证 provenance 的备份，在全新目录准备；r24 正式 PREPARED 记录为 `.creative-test-results/production-prepared-r24.json`，staging `/www/helstera/.helstera-candidate.lMzqTW`。另经新校验器独立复核 exact code parity 通过。

系统盘初次容量守卫差约 90 MB。40 份可再生成的 APT 索引共 150,404,783 字节已逐文件复制到 `/www/helstera/.system-cache-backup-20261116-r24`、SHA 校验后从原缓存位置释放，lock 和子目录保留；原数据与回执保留可恢复。Playwright 浏览器缓存 598 个文件、711,303,511 字节已逐文件校验后迁到 `/www/helstera/.system-browser-cache-20261116-r24`，原路径 `/root/.cache/ms-playwright` 是兼容符号链接，未改变二进制内容。实际 Chromium 启动及公网缩略图解码验证通过。系统可用空间恢复到约 7.39 GB，守卫未减弱。证据：`production-system-cache-preservation-r24.json`、`production-browser-cache-relocation-r24.json`、`production-browser-cache-validation-r24.json`。

## 候选与未完成项

r24：4,364 条目、166,519,278 字节，SHA-256 `80ae85c49d73d21fe19a5b3ae4396fb49a9526508739a75195acb34b624547a1`，已准备、未部署。

r25 在 r24 基础上修复空 `PUBLIC_MEDIA_MANIFEST` 覆盖旧 `QINIU_PUBLIC_MANIFEST` 的兼容问题，新增两项回归先失败后修复；非空通用配置仍优先。线上独立服务使用显式非空路径，未被此问题影响。r25：4,364 条目、166,519,410 字节，SHA-256 `99327e13ace30927197ada958a021ee245d71be27fa687ed56eeb41f8e6867d8`，归档、Server 当前源码字节比较和 Shared 两份 dist 已验证。正式 PREPARED 已完成，收据 `.creative-test-results/production-prepared-r25.json`：staging `/www/helstera/.helstera-candidate.Tn9zZb`，复用上述已核验备份，完整隔离恢复及 11 项迁移演练成功。生产数据库没有应用这些迁移，完整候选没有上线。

最新后端定向媒体/健康测试 44/44 通过，Server 类型检查与媒体模块 Biome 通过。发布/拓扑/路由等综合 Python 检查曾运行 116 项、3 项平台跳过；后续完整树准备新增用例另经 115 项组合检查、2 项平台跳过。各检查是不同集合，不相加为不重复总数。前端最近完整证据保持 937/937 和 68 页构建通过，本轮未修改前端。

主 API/Worker 仍是 `0.0.0-stability-20261110-1`，没有 process-authored 生命周期回执；完整切换仍需一次经过测试的 legacy bootstrap，不能补造旧 ready/drained 回执。候选 API 启动会执行恢复、goal worker 和维护写入，因此不能声称将未路由 API 连生产库启动是只读验证。真实 Electron Windows sandbox 问题、登录后完整用户流程、全仓 Biome 及字幕来源契约仍未闭环；目标未完成。
