# 节点检查与局部执行

本轮借鉴 n8n 的节点输入/参数/输出检查、按节点调试及执行排查方式，在本站工作流上独立实现。没有复制 n8n 代码、品牌或节点插件，也没有将其作为托管服务嵌入。参考的是官方 [节点操作](https://docs.n8n.io/build/understand-workflows/workflow-components/work-with-nodes.md)、[局部执行](https://docs.n8n.io/build/understand-workflows/understand-executions/types-of-executions.md) 与 [LICENSE](https://github.com/n8n-io/n8n/blob/master/LICENSE.md)，查阅于 2026-11-09。上游使用 Sustainable Use License，不能仅凭仓库公开就当作商业再分发授权。

## 本轮行为

- 节点侧栏切换输入、参数、输出；展开后并列检查三个区域。结果读取既有鉴权接口，显示运行版本、执行状态、错误和素材可用性；过期/撤销素材不提供有效预览。
- 选择工作流连线后可插入节点。兼容性双向校验，成功后一次替换成两条连接，保留下游输入的顺序；不兼容或连线已改变时不修改原图。
- “执行到此节点”列出目标及所有必要上游，明确上游会重新执行。服务端根据保存版本重新计算范围，以独立交付步骤回流结果，不改动保存图、不执行其他分支、不复用旧运行的审批。纯网址/搜索节点需选其下游处理节点执行。
- AI 结构化计划和主对话工具支持 `run.targetNodeId`，目标保存在提案中，确认卡列出实际执行范围。非 run 指令不能指定目标；仍保留模型费用、录制动作审批及未知结果核验。
- 运行记录可筛选全部、需处理、已完成并定位对应节点；局部运行标明目标。合成交付的内部步骤不提供无效定位按钮。

## 校验与恢复

新增迁移 `20261109000000_workflow_partial_runs` 仅向运行记录及 AI 提案各增加可空 `target_node_id`，兼容既有请求和历史记录。SHA-256：`5986504463342a23aba89dba027e3543f6322d4a7adf0a65b39ecd5d54fb8ece`。运行幂等键同时核对版本及目标，重复确认返回原回执，改变范围不能借用旧请求。工作区/画布所有权、聊天关联与素材权限仍在服务端校验。

刷新回归曾发现：未加载工作流 ID 时，普通画布箭头的空绑定与空 ID 匹配，读取 edgeId 引发页面错误。已在无流程 ID 时排除工作流连线；保留刷新后检查真实结果的测试。

## 验证证据

- Shared 图编辑、局部编译和原有流程共 9 项通过；Shared 构建通过。
- 隔离 PostgreSQL 工作流 14 项通过，包含局部范围、不改原图、重复确认、越权、AI 提案确认及录制未审批不执行。
- Web 组件与场景 18 项、Agent 工具和结构化规划器 2 项通过；Server/Web 类型检查及生产兼容 Server/Web 类型检查通过。
- 真实 Chromium 验证插入→确认局部运行→截图→私有结果→刷新恢复；最终版本通过，37.7 秒。Windows 0.2.21 隔离候选版四项 E2E 通过（1.3 分钟），覆盖节点检查、AI 对话、菜单、拖拽、草稿恢复和窄窗口。
- 网站录制审批用确定性网页适配器验收，真实 Chromium 产生截图；这里没有把该适配器描述成生产录像或真实模型推理。生产待确认的 0.16 积分生成任务不参与验收。
- 新 Shared 测试加入 Agent Closure CI，新 E2E 加入 `playwright.workflow.config.ts`，沿用 CI 的真实浏览器安装和 PostgreSQL 服务。

日志在 `M:/loomic-builds/`：`workflow-n8n-shared.log`、`workflow-n8n-postgres.log`、`workflow-n8n-unit.log`、`workflow-n8n-tools.log`、`workflow-n8n-browser-final.log`、`workflow-n8n-desktop.log`、`workflow-n8n-build.log`、`workflow-n8n-candidate-types.log`、`workflow-n8n-production-types.log`。

本轮没有实现 n8n 的完整第三方连接器库、通用脚本执行、触发器平台或固定数据替代运行；本站现有创作节点、普通画布及审批语义保持兼容。

## 生产验收

功能提交 `87cd824` 已推送至 `codex/agent-workspace-ci` 并发布。26 个 Server/Shared 文件校验通过，增量迁移已核验；Web 校验 3251 个文件，四个主要入口返回 200。线上画布 HTML SHA-256 与候选一致：`8b7b66c9328ad41967ebfcbbe912f1ea5b31ca6e28d84377531c1aa2fb2feda9`。Server/Worker 均 online，健康接口正常，未登录工作流接口返回 401。

在已登录原画布建立独立的“节点调试验收 · Example Domain”，保留原工作流及本机恢复草稿。通过节点确认卡只执行 `https://example.com` 的读取与截图及本次结果保存，生产运行 `ebee1a88-84da-419a-8ca7-0c0cef837de9` 为 completed，target_node_id=capture。刷新后展开节点，输入、参数及输出仍可读取，图片实际加载为 1280×720；结果也已回到画布及原聊天。

生产真实模型随后生成局部运行方案 `613efcd8-4238-4721-9231-7211ad84354f`，action=run、target_node_id=capture、status=pending。确认卡列出读取/截图及结果保存，未自动再执行。数据库最终仍只有一条本轮局部运行，未调用生产图片/视频生成。

发布日志：`workflow-n8n-deploy.log`、`workflow-n8n-publish.log`；数据库和健康证据：`workflow-n8n-production.log`；截图：`workflow-n8n-live-workbench.png`、`workflow-n8n-live-output.png`、`workflow-n8n-ai-proposal.png`，均在 `M:/loomic-builds/`。功能提交的网站捕获 CI 已通过；最后检查时 Agent Closure 与 Desktop Candidate CI 仍在运行，不能将本地候选版验收称作新 CI 全绿。
