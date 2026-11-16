# 2026-11-12：发布事务与资源租约续作

工作目录：`M:/loomic-builds/Loomic-continuation-20261112/Loomic`，基线 `749a256`。本次未使用子智能体，未操作生产服务、清理生产文件、提交或推送。以下是局部进展，不代表九项总体目标完成。

## 发布事务

`deploy-production-candidate.py` 默认调用主机端 `blue-green-release.py`。显式的 `--allow-single-instance-outage` 仍选择旧停机发布路径，不能用于证明连续可用。

默认路径先通过 `release-topology.py` 读取有效 Nginx 配置、PM2 在线进程及其工作目录。支持审计中出现的 3003 上游和 blue/green 进程名，拒绝多个在线 API、多个上游、API/Worker 版本目录不一致以及活动指针与实际状态冲突。旧 `/www/helstera/apps/server/src` 不再自动视为线上源代码。

候选代码与依赖留在独立目录，备份记录实际代码目录与静态目录。不可变安装包和旧 `_next/static` 通过同盘硬链接保留，避免复制安装包字节，并让旧页面仍能加载对应资源；不覆盖候选中已有的同名文件。跨文件系统无法链接时明确失败。准备期间活动版本发生变化时阻止切流。

事务顺序：候选 API 启动并通过依赖就绪检查 → 旧 Worker 排空 → 新 Worker 就绪 → 同一份 Nginx 配置切换 API 和静态目录 → 公网版本、Agent 匿名鉴权及静态文件哈希检查 → PM2 与活动版本持久化 → 停止旧 API。每阶段之前写入独立事务日志。

异常时先恢复原路由，确认新 Worker 已排空后才能重启旧 Worker。原路由恢复失败时同时保留候选 API 和 Worker，避免新 API 对接旧 Worker；Worker 排空状态不明时拒绝强制重启。已提交版本仅旧 API 退出失败时记录清理错误，不切回已停止的旧服务。

Server/Worker 的 `process-receipt.ts` 将 PID、实例标识、角色和 ready/drained 状态原子写入文件。drained 仅在任务和连接清理后写入。缺少旧 Worker 回执时在停止进程前拒绝发布，不能用 PM2 stopped 状态冒充安全排空。

模型配置继承实际运行进程的环境和 Node 环境文件，包含启动 shell 导出的设置；过滤 Node IPC 文件描述符及实例控制变量，避免独立探针崩溃。环境不写入事务日志；PM2 启动配置以私有文件保存。

## 验证证据及边界

- 运行时定向测试：`process-receipt`、`queue-runner`、`drain-gate`、`media-admission`，16 项通过。租约释放失败会等其他活动任务排空后拒绝关闭成功，不能仅记日志便写出 drained 回执。Server 类型检查退出 0。
- 发布事务测试覆盖每个变更阶段失败、路由回滚失败、候选 Worker 排空失败、旧 Worker 仍在 stopping、重复事务日志、活动源目录和跨次发布。
- 独立 HTTP 子进程持续探测成功路径和回滚路径，探测结果全部 HTTP 200。
- WSL Ubuntu 的真实 Nginx 测试调用生产适配器的配置切换和恢复方法，运行独立 master、独立配置及两个 HTTP 子进程。发现并修复 reload 返回与新 worker 生效之间的等待问题；成功切流和故障回滚的连续探测均为 HTTP 200。此测试不等于真实 PM2、真实业务 API、长时 WebSocket 或生产演练。
- 后续补充 `scripts.test_blue_green_pm2`：WSL Ubuntu + Node 22.16.0 + PM2 6.0.8 + PostgreSQL 16 + 独立 Nginx，5 项通过（72.810 秒）。使用真实发布适配器、实际进程回执和生产队列运行器；HTTP 表面与任务载荷为隔离夹具。覆盖任务执行中交接、PM2 kill/resurrect、失败回滚时等待候选任务完成、强制超时不冒充排空、切流后/活动指针持久化后的进程立即退出与重复恢复。最新成功路径 320 次、回滚路径 422 次 HTTP 采样均为 200；两个任务各执行一次且进度完成为 100。此证据不证明整套业务 Server、真实供应商或系统开机服务已验收。
- 临时 PostgreSQL 16 集群中的真实媒体租约测试通过，包含双客户端并发互斥、精确入场容量边界、过期租约失效、取消和幂等释放。只对临时 schema 使用模拟磁盘容量；数据库锁和读写是真实 PostgreSQL。测试完成后集群已停止，临时目录已删除。
- CI 已加入回执、媒体容量及真实 Nginx 事务回归；仅验证了本地命令和 YAML，未推送、未声称远端 CI 成功。

## 尚未达到生产发布条件

1. 需要只读核验当前主机空间、Nginx 实际配置、PM2 工作目录、进程回执和环境文件。历史容量记录不作为当前空间结论。
2. 现有旧版本若无回执，需要单独设计并验收生命周期支持的引导迁移。当前默认路径会明确拒绝，不能假称已能无停机升级所有旧版本。
3. 默认事务只接受所有候选迁移已存在且校验和匹配的数据库；有待应用或漂移迁移时拒绝发布。尚未实现在线增量迁移的兼容性批准与执行。
4. 真实 PM2 候选启动、SIGINT/超时、排空回执、kill/resurrect 与旧实例退出已通过隔离夹具验收；仍须覆盖真实业务 Server/Worker、系统开机服务以及长时 HTTP/WebSocket。
5. 已补事务中断后的 `--recover` 和进程立即退出故障测试；尚未做真实 SSH 断连与整机故障演练。
6. 备份恢复、部署空间预算、超长任务与供应商在途状态仍须完成当前候选的联合验收。

## 中断后的显式恢复

使用该事务的原始 root、staging、config 和 public-url 参数运行主机上已校验的 `blue-green-release.py`，附加 `--recover`。脚本要求参数与 `transaction-context.json` 一致，检查配置快照哈希、PM2 工作目录和回执身份，不重新提交任务。

```sh
python3 /DEPLOY_ROOT/.helstera-candidate.TOKEN/blue-green-release.py \
  --root /DEPLOY_ROOT \
  --staging /DEPLOY_ROOT/.helstera-candidate.TOKEN \
  --config /etc/nginx/sites-enabled/studio.0st.top.conf \
  --public-url https://studio.0st.top/api/health \
  --recover
```

上例的目录是占位符，必须使用实际事务记录。已持久化为候选且路由一致时验证当前版本并完成旧 API 退出；未提交时恢复前一版。恢复成功后再次执行只核验或完成清理，不重启已恢复的旧 Worker。路由被第三方修改、身份不符、排空不确定时保留现场并报错。

CI 以 `HELT_RELEASE_TEST_REQUIRED=1` 执行真实 PM2 测试，缺依赖不能静默跳过。每个测试使用独立 `PM2_HOME` 和 PostgreSQL schema；结束后停止自身 Nginx/PM2 并删除 schema，不调用共享 PM2 daemon。

## 2026-11-13 续作验证

- `pnpm.cmd typecheck`：Turbo 6 个包全部成功（Config、Shared、UI、Desktop、Server、Web），Web route type 生成成功；耗时 20.877 秒。
- Server 运行时定向回归：18 项通过、2 项跳过；覆盖 Agent 租约、WebSocket 排空、队列释放、媒体入场容量、进程回执和 DrainGate。跳过项是未提供真实 PostgreSQL 测试数据库的租约实库测试，不作为通过证据。
- Web 工程中心定向回归：4 个文件、15 项通过；覆盖工程上下文、刷新失败重试、首页工程恢复和项目视频同步。
- Windows 发布脚本回归：`python -m unittest discover -s scripts -p 'test_*.py' -q` 共 122 项通过、8 项跳过、无错误，耗时 9.858 秒。跳过项均为 Linux Nginx/PM2/PostgreSQL、`renameat2` 等平台条件；没有把它们冒充 Windows 通过。
- 发布门禁新增并检查 Agent 租约迁移、租约服务、DrainGate、进程回执、队列运行器和 WebSocket handler，避免候选包只带业务入口而漏掉排空依赖。
- Ubuntu PostgreSQL CI 门禁现已直接调用 `src/local-db/agent-run-lease.postgres.test.ts`；对应配置回归通过，避免本地因缺少数据库而跳过后仍被误判为已覆盖。
- `prepare-agent-marketplace-candidate.py` 在没有预生成 `deploy/server-runtime` 时会从当前锁文件和已构建 Shared 产物生成临时 runtime；对应归档测试通过。`isolated-pg-rehearsal.py` 在 Windows 可导入但仍明确要求 POSIX root/postgres 账户才能实际运行。
- 目标临时 PostgreSQL 路径 `/tmp/helstera-integration-pg-jlomypm2` 不存在，端口 `46461` 未监听；未停止或删除其他 PostgreSQL 进程。

本段证据仍只覆盖本地隔离测试和静态门禁；没有生产空间、线上 Nginx/PM2、真实业务 Server/Worker 或生产部署证据，因此九项目标仍未完成。

## 九项目标续作位置

| 目标 | 当前续作与所缺证据 |
| --- | --- |
| 生产稳定与容量 | 本轮发布事务、排空回执及租约实库测试；以上生产条件未完成 |
| 统一工程中心 | 同一工作树保留首页工程恢复改动，跨视图/跨设备冲突尚需验收 |
| 媒体处理引擎 | 代理视频、增量编译、10–30 分钟 4K 和低内存压力证据仍需补齐 |
| 完整本地工程 | 离线编辑、素材身份、跨设备同步冲突与独立副本仍需逐项核实 |
| Agent 执行中心 | 跨画布/浏览器/视频/试穿的统一产物与恢复链仍需核实 |
| 费用结算 | 供应商实际费用、在途取消、未知结果核验和退款凭证仍需实证 |
| 全站交互 | 统一操作规则及嵌入运行时完整回归仍需验证 |
| 创作场景 | 三条端到端创作场景的真实输入、费用、成片与恢复证据仍需补齐 |
| 模块与质量评测 | 诊断关联、模块拆分、模型/成片质量及返工评估仍未证明完成 |

## 2026-11-13 容量策略续作

- 新增 `apps/server/src/config/capacity-policy.ts`，将系统盘、业务盘、媒体准入、媒体运行中预留和每盘媒体并发上限集中配置；默认值保持原有 512 MiB、64 MiB、2 GiB、512 MiB、单并发门禁。
- `probeWritableStorage`、健康就绪检查、网站录制和 OneTake 均使用同一策略；低空间诊断现在包含路径、标签、可用字节、需求字节和不足字节，不把凭据或底层异常回传给客户端。
- 容量策略、存储探针、媒体准入、健康检查和队列回归共 23 项通过；Server TypeScript 检查通过；`git diff --check` 通过。
- 这仍是隔离工作树证据，尚未证明生产主机当前空间、线上 Nginx/PM2 状态或真实生产发布；队列活动任务的停机检查点仍需单独设计，不能把本轮结果当作九项目标完成。

## 2026-11-13 媒体预览闭环续作

- 资产库缩略图现可打开原件预览窗：视频使用带控件的原始媒体流，不预先下载整段视频；私有文件先通过播放授权接口获取短期 Cookie，并继续遵守文件权限与到期校验。
- 图片和视频预览都有解码错误、重新授权/读取、下载原件入口。缩略图解码错误会从加载态转为明确错误并允许重试；切换或关闭素材时中止旧授权请求，避免旧响应覆盖新素材。
- 原文件下载名按 MIME 扩展名映射，包含 WebM；服务端视频首帧生成设 15 秒上限，失败返回可读错误，避免损坏文件长期占用预览槽。媒体 ETag 改用文件身份/变更指纹，Range 播放不再先全量读取大视频计算哈希。
- 前端定向回归：6 个文件、17 项通过；服务端媒体路由、预览缓存与文件版本：3 个文件、10 项通过。Web 与 Server TypeScript 检查通过，`git diff --check` 通过。
- 验收仅为隔离工作树中的 jsdom/Vitest 与 Fastify 注入测试；尚未用真实登录浏览器验证私有 Cookie、媒体 Range 请求与实际解码，也未部署生产。此项不代表整体稳定性、容量或发布目标完成。
