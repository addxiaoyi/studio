# 2026-11-16 r9 续修与候选核验

工作目录：`D:/qwq/项目/scpit/.codex-worktrees/Loomic-continuation-20261112/Loomic`；分支：`codex/production-closure-20261115`。

## 本轮代码修复

- 充值页面按 `userId + access token` 隔离生命周期。旧账户的订单轮询、支付跳转、错误和到账提示在切换账户或卸载后都会被丢弃；当前账户仍可完成充值并刷新余额。
- Assets 页面保留同 token 换账户时的组件隔离，旧画布导航、下载和预览 Blob 不会写入新账户。
- 桌面下载清单以每轮请求为准：撤回的 404 会移除旧链接；临时网络失败保留旧版本并显示未更新状态和重试入口；旧请求、语言切换和卸载后的响应不会覆盖当前清单。
- 原生桌面截图和按键自动化分别保留检查、OCR 终止、临时目录清理和按键释放的错误上下文。清理失败会继续执行后续清理并返回 `AggregateError`，不会吞掉原始操作错误。
- Gallery 字幕使用独立 publication 快照；作者明确勾选并选择真实 VTT 后才公开，撤回后新 VTT 请求立即拒绝，播放器只在存在真实字幕时创建 track。
- `/api/health/ready` 增加公共媒体依赖探针。配置 Qiniu manifest 时读取首个对象的单字节 Range；上游不可读或响应与 manifest 不符会返回 503，避免本地磁盘正常却把公共媒体故障报告为 ready。
- Fastify 原始 webhook 请求体改用类型安全的 `FastifyRequest.rawBody` 扩展；Server 入口移除存储路径和 LightPay 配置的非空断言。
- Feed 时间线 URL 和导出包下载路径改用明确的可选存储提供者检查，未配置存储时返回既有可解释的冲突响应。
- Feed 发布计划更新接受 `Pool` 或事务 `PoolClient`，避免数据库事务路径依赖 `any`。

## 验证

- Web 全量：917/917 通过，0 失败，0 跳过；类型检查通过；生产构建 68 个页面完成。
- Shared：205/205 通过，构建通过。
- Server：1,337 通过、24 个明确环境跳过、0 失败。跳过项需要专用 Agent 数据库、真实 Electron、真实媒体/音频、外网录制或 live capture 开关，不是本轮回归失败。
- r8 公共媒体 readiness 定向回归：29/29 通过；Server 类型检查通过；实际提取的 Shared parity 6/6 通过。
- Desktop：210 通过、9 个环境跳过；原生自动化清理回归 26/26 通过；桌面类型检查通过。
- Python 发布与回滚套件：179 项运行，165 通过，14 项平台/环境跳过。
- r11 候选：`.codex-release/production-closure-20261116-r11.zip`，4,361 条目，166,511,626 字节，SHA-256 `ffd5f3de91d621e76b2eafff962bc2cdf606b8ca2dbc4db751fe862afd19233e`。发布器验证 manifest、路径、摘要、Creative runtime、Server tree 和实际提取的 Shared 212 文件 parity 均通过。`.codex-release/LATEST.json` 已更新为 r11，`deployed: false`。

## 当前线上证据

2026-11-16 00:21 UTC 只读探测保存在 `.creative-test-results/public-probe-r9-final.json`。`/api/health/ready` 返回 200，但版本仍为 `0.0.0-stability-20261110-1`，尚未包含 r9 的 readiness 探针。有效 Qiniu 图片仍返回 502 `media_unavailable`，存储标识为 `qiniu`。

## 未闭环条件

本会话没有 `HELT_DEPLOY_PASSWORD`，已配置跳板的 SSH 密钥认证也未通过，因此不能读取生产存储日志、核对生产迁移/容量、部署 r7 或做部署后真实 Gallery 验收。全仓 Biome 仍有既有源码诊断；Electron 真实 Chromium UI 仍受当前 Windows token 的 sandbox 权限限制。上述条件恢复后，应先读取生产日志定位 Qiniu 502，再执行候选部署和健康、媒体、认证及回滚验收。
