# 2026-11-16 production public gallery recovery

工作树：`D:/qwq/项目/scpit/.codex-worktrees/Loomic-continuation-20261112/Loomic`；分支：`codex/production-closure-20261115`。

## 已恢复的线上行为

用户提供目标机认证并明确选择先恢复本地公共媒体后，已上线独立只读公共媒体服务，切换公开图库与对应公共 API 路由。2,814/2,814 个公网原图和缩略图全部读取成功、逐文件 SHA-256 与源 manifest 一致，0 失败，总字节数 129,292,630。完成时间为 2026-11-16 10:12:49 UTC；4 并发校验用时 194.4 秒。

原 API 和 Worker PID 仍为 1027、1030，均在线且没有重启。没有数据库迁移或业务数据写入。主应用仍报告 `0.0.0-stability-20261110-1`；前端和主 API/Worker 的完整 r23 候选尚未发布。

## 根因与修复

- 七牛 S3 实际读取返回 HTTP 403、`AccountProblem`，说明账户侧拒绝操作；原始说明要求联系服务方，没有证据证明是欠费或凭据失效。
- 环境文件中的原 `QINIU_PUBLIC_MANIFEST` 指向已删除的临时文件。旧进程保留内存中的 manifest，因此仍能启动此前的请求链，但重启可能失败。现已重建稳定 manifest，备份并更新两份环境文件中的公共媒体路径；用旧版本代码重新加载当前配置已验证 2,814 条记录可加载。
- 生产与当前候选的公开服装目录均为 1,407 套、2,814 个文件；完整 canonical manifest 哈希一致。仅复制已公开 catalog 指定的原图和缩略图，没有扫描或发布用户上传目录。
- 新 `local-public-media.ts` 复用白名单和 SHA 校验，检查真实路径边界，先以流校验再从同一文件句柄提供内容；保留 ETag、Range、If-Range、416 和错误脱敏。缺失或损坏时 readiness 返回 503。
- 原进程没有 drain receipt，完整蓝绿发布工具会拒绝直接切换。本次用独立回环媒体进程恢复公开资源，保持主 API/Worker 的发布门禁。

## 实际上线范围

代码包：`.codex-release/public-media-recovery-20261116-r1.zip`，9,776 字节，7 个源文件及 release manifest；SHA-256 `2782da74213b9c0d56661834927ee9d937b2293c283ff384668f70a1b45fe195`。

服务：`helstera-public-media-recovery`，PID 672300，监听 `127.0.0.1:3014`，PM2 已保存。版本为 `public-media-recovery-2782da74213b9c0d`。公开文件与配置位于 `/www/helstera/.public-media-recovery-20261116-r23`，服务使用该目录的 `public` 子目录和 `manifest.json`。

Nginx 仅调整 `/fashion-gallery/img/`、`/fashion-gallery/thumbs/`，并添加两个对应的 `/api/public-media/fashion-gallery/` 前缀。通用 `/api/` 继续连接原应用。配置快照、前后哈希、两份环境文件的私有备份与 PM2 原快照均保留在恢复目录；备份内容没有复制到工作树或排障报告。

完整候选另为 `.codex-release/production-closure-20261116-r23.zip`，4,364 条目、166,518,343 字节，SHA-256 `6fad5198dc3cf52fd52beeb313f25044dee6141ff078dd83385b94feef25a956`。完整性、Server 当前源码字节比较与 Shared 两份 dist 校验通过，`deployed: false`；不能把独立媒体服务的上线当作完整候选发布。

## 验证与证据

- 本地后端媒体/健康/独立服务定向回归 39/39；先加入本地模式的失败回归再实现。Server typecheck、5 个媒体模块/测试文件的 Biome 通过。
- 本地完整 Server 批次 1,114 项通过、257 项按环境条件跳过；独立入口新增两项随后纳入 39 项定向检查。此前完整 PostgreSQL 和真实媒体验证见 r19，不把环境跳过当作通过。
- 前端账户/项目切换与迟到持久化/导入请求新增 12 项回归先失败后修复；229 个文件、937/937 项通过，类型检查与 68 页构建通过。日志：`.creative-test-results/web-studio-account-final-20261116.log`、`web-studio-account-build-20261116.log`。
- 公网原图、缩略图、两类直接 API 读取 200 且 SHA 一致；Range 206、ETag 304、越界范围 416；缺失文件和私有路径 404，未登录的 `/api/jobs`、`/api/agent/goals` 仍为 401。记录：`.creative-test-results/production-public-recovery-external-smoke-r23.json`。
- 全量 2,814 个公网文件的逐文件报告在服务器 `public-postflight.json`；其 SHA-256 为 `6687c8a9e39bb54b92e03b2dd9856f658ea1e9056ca93f1206df44211d2c2f53`。本地摘要：`.creative-test-results/production-public-inventory-postflight-r23.json`。
- Node 20.20.2 实际运行独立服务；Chromium 对公网原图和缩略图解码成功，尺寸分别为 1366×2048、360×540。记录：`.creative-test-results/production-public-browser-decode-r23.json`。
- 独立回环 Nginx 实例执行真实配置验证、reload、切换及回滚：原路由 502、恢复路由 200、回滚 502，配置字节恢复准确；生产配置未变，演练监听已停止。记录：`.creative-test-results/production-public-rollback-rehearsal-r23.json`。公网未被实际回退到已知故障路由。
- PM2 持久化完成，恢复服务重启数 0；全量核验后 25 个文件描述符、RSS 115,760 kB。记录：`.creative-test-results/production-public-persistence-r23.json`、`production-public-final-state-r23.json`。
- 匿名浏览器访问图库会重定向登录，不能据此宣称已登录图库 UI 验收。图片解码与登录后交互验证分开记录。

## 尚未完成

完整 API/Worker/前端发布与迁移、旧进程生命周期升级、登录后的真实用户流程、Electron Windows 环境问题及全仓代码诊断仍未闭环。七牛账户侧拒绝没有被修复，当前图库由已核验本地只读服务接管。恢复进程固定依赖旧不可变 release 的 node_modules；在恢复服务退役前必须保留该依赖树，见运行手册。
