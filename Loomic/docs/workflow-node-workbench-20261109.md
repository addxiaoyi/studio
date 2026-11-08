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
