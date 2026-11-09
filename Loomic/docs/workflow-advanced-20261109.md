# Switch、批量处理、缩略导航与版本恢复

本轮扩展已有画布流程，保留单击选择、双击设置及生成费用逐项确认。

- Switch 支持最多6条规则、按顺序首次命中或全部命中，以及无规则命中时的默认出口；分支出口随连线保存，未命中步骤在审批和执行器调用前跳过。
- 列表拆分读取 JSON 数组或按分隔符拆分文字。批量循环串行应用字段提取、文字处理和模板，最多100项、每批1至10项、每项最多8个动作。模板支持 `{{text}}`、`{{index}}`；超限先报错，结果限制24000字，不执行任意脚本或模型生成。
- 每批将输入摘要、已处理项、结果摘要和计数写入既有步骤回执。Worker 重新启动后从已完成项继续；回执与输入不一致时停止。暂停、取消和权限撤销沿用既有租约核验。
- 工作流扩展至64节点、128连线，每节点最多8输入。缩略导航包含分组、节点与连线，支持按名称/备注查找和键盘定位；不打开节点设置。折叠分组仍可定位。
- 新增 `20261109000001_workflow_versions.sql`：保存当前图与历史完整运行图，触发器记录后续普通保存和 AI 修改。列表每次20版，可加载更早版本。恢复先展示图和参数差异，复核权限及当前版本后另存为新版本，不运行流程。运行期间或版本冲突时拒绝覆盖，旧版本保留。

## 本地证据

- 新回归先失败：`workflow-switch-red.log`、`workflow-batch-red.log`；实现后 Shared 21项、Server 12项、Web 20项通过。
- 隔离 PostgreSQL 18项通过：版本权限/冲突/恢复不执行，真实批次回执写入、替换 Worker 后继续且不重复；原有分支、费用门禁、私有素材和固定结果仍通过。
- Chromium 2项通过（1.0分钟）：实际执行 `JSON→拆分→批量整理→Switch→命中/默认→合并→交付`，两次不同分支输出，恢复为第3版但运行数保持2；48节点分组缩略导航、键盘、窄窗口版本弹窗通过。
- Windows 0.2.21 隔离候选2项通过：新增完整链路，以及旧节点单击/双击、拖动与端口连线；同一批测试另含48节点 Chromium 验收，共3项1.5分钟。未据此声称 macOS/Linux 真机已验收。
- Shared 构建、Server/Web/Desktop 类型检查和生产基线 Server/Web 类型检查通过。新增生产模块 Biome lint 7文件通过。
- 日志位于 `M:/loomic-builds/`，前缀 `workflow-advanced-`，分别为 `contracts.log`、`unit.log`、`ui.log`、`postgres.log`、`browser.log`、`desktop.log`、`*-types.log`、`lint.log`、`production-build.log`。

## 发布

候选包在生产现有基线上合入，继续保留已有视频、女装、登录和对象存储改动。新增表和触发器为兼容增量迁移；旧服务可继续使用原表。上线前核对迁移校验和、在途任务与文件哈希，上线后检查服务、真实保存/恢复和分支执行回执。最终部署与 CI 结果将在完成后补充。

2026-11-09 已上线。版本迁移记录校验和 `dfbbab8a164a4f36e4309a14c2c48f820d3a0c19a99680c7799a64ee25c4d88a`，Server/Worker 在线。Web 核验3251文件。后续完成真实模型格式修正与审批参数展示修复，提交 `2df2c79`、`b15777b`。

生产独立验收流程 `323ad276-e228-4000-ae8f-c8f06486d2ed` 有8节点8连线。真实模型首次给出无效分组ID，系统在原请求范围修正一次，再经确认应用；无付费生成。运行 `897d234a-c800-43dc-a57d-9798f56df070` 命中 alpha，输出 `MATCH 1. ALPHA 2. BETA 3. GAMMA`；运行 `49604194-3a3c-4037-8ee4-e52460c207b1` 命中 default，输出 `DEFAULT 1. ALPHA 2. BETA 3. GAMMA`。两次批量均 `attempt=1,processed=3,total=3`，未命中模板 `attempt=0,skipped=true`。

UI 对比 `NOT_FOUND → ALPHA` 后将第3版恢复成第5版，运行总数仍为2，刷新保留节点与分组。生产截图 `M:/loomic-builds/workflow-advanced-versions.png`；数据库证据 `verify-workflow-advanced.log`。

`b15777b` 的 [Agent Closure](https://github.com/addxiaoyi/studio/actions/runs/42551977992) 与 [Desktop Candidate](https://github.com/addxiaoyi/studio/actions/runs/42551977911) 均已成功；生产页面后续由 UI 统一改进发布接续。
