# 2026-11-16 r19 verification

工作树：`D:/qwq/项目/scpit/.codex-worktrees/Loomic-continuation-20261112/Loomic`；分支：`codex/production-closure-20261115`。本轮没有生产部署。

## 数据库测试入口修复

r18 对扩展竞态的修复结论不足：单个 fixture 的 session advisory lock 不能约束其他 fixture 的扩展 DDL，异常时也可能遗留锁。现已撤销该局部锁，改由 `scripts/test-local-postgres.mjs` 在启动测试 worker 前安装 `public.pgcrypto`，与 CI 的预建方式一致。准备函数使用事务级 advisory lock，成功提交，失败回滚并关闭连接。4 项 Node 测试验证成功、DDL 失败、连接失败和回滚失败；CI 已增加此检查。

本地入口限制最多 4 个 worker，在保留各测试内部并发断言的同时控制 fixture 资源竞争；未修改原测试超时或减弱断言。全新 PostgreSQL 17 集群运行 34 个 PostgreSQL 文件，233 项通过、2 项按条件跳过，未出现扩展竞态或超时。日志：`.creative-test-results/postgres-bounded-20261116.log`。

## 真实媒体与完整 Server 验证

启用公开页面录制后，旧 fixture 先因缺少 `media_resource_leases` 表失败，再因媒体保留期列缺失导致鉴权读取 500。已补齐真实迁移与表结构，原有拒绝、Range 和播放断言保留。真实录制 10/10 通过，含截图、WebM 录制、浏览器解码、权限隔离、Range 与聊天交付。

- Server `src` 的 236 个测试文件：1,326 项通过、4 项条件跳过，进程退出码 0；启用了临时数据库、真实 MP4、公开页面录制与 Agent goals。日志：`.creative-test-results/server-with-postgres-final-20261116.log`。
- 根目录 `test` 的 6 个文件：33 项通过，退出码 0。
- 将离线 Python 与合成语音视频传给此前跳过的 OneTake、Canvas 媒体测试：2/2 通过，含真实转写、字幕导出、剪辑合成与帧解码。日志：`.creative-test-results/media-offline-final-20261116.log`。
- 实际提取 r19 的 Shared 副本运行 parity 测试：6/6 通过，包含完整套件中默认跳过的真实副本比较。日志：`.creative-test-results/shared-r19-parity-20261116.log`。
- 上述分组验证覆盖 Server 合计 1,362 项通过；最后一项真实 Electron 测试实际启用后失败，不能列为通过或继续称为仅跳过。Electron fixture 连接前退出，code `2147483651`、signal null，无原因日志；Agent goals 同批另外 18 项通过。日志：`.creative-test-results/agent-real-electron-final-20261116.log`。
- Server typecheck 通过；数据库准备入口、准备函数与单元测试、worker-process fixture 均通过单文件 Biome。

## 候选与未完成项

最新候选 `.codex-release/production-closure-20261116-r19.zip`：4,361 个条目、166,512,496 字节；SHA-256 `7e63bad3d6eeb7e20bdc9d08633142e5a0f47d0769a4bceddce001e9554399e0`。manifest、路径安全、全部摘要、提取树与 Creative runtime 校验通过；归档 Server 文件清单和字节与当前工作树逐项一致，两份 Shared dist 共各 212 个文件与当前构建一致。验证脚本：`.creative-test-results/verify-r19.py`；收据：`.creative-test-results/candidate-r19-verified-20261116.json`；`deployed: false`。

2026-11-16 08:19 UTC 只读线上复查仍显示 `0.0.0-stability-20261110-1`，readiness 200 但没有 `publicMedia` 检查；有效图库图片返回 502 `media_unavailable`、`X-Media-Storage: qiniu`。原始响应：`.creative-test-results/public-probe-r19.json`。生产凭据未设置，生产日志、Qiniu 502 根因、部署与迁移/容量/媒体/认证/回滚验收仍缺失。全仓 Biome 与私有视频字幕契约也未闭环。

临时集群 `D:/UserCache/Temp/helstera-pg-closure-20261116` 已确认停止，没有 postmaster.pid；自动执行策略拒绝递归删除该目录，因此保留数据目录，未绕过限制。不要在未重新确认进程状态时删除任何集群目录。
