# AI 对话搭建与操控工作流

画布侧栏“AI 搭建”改为持久对话。请求调用工作区真实Agent模型，模型只能返回结构化edit/run/pause/resume/cancel/retry/inspect指令；上下文包括当前流程、选中节点、用户明确引用的素材、真实步骤状态、模型目录和最近对话。缺少能力或信息时返回解释，不执行代码。

主聊天Agent的draft_canvas_workflow改为待确认的方案卡，inspect_canvas_workflows读取真实流程与运行，新增control_canvas_workflow准备运行控制。选中的节点ID和所属流程随消息传入，服务端仍校验所有者和画布范围；涉及工作流的视频请求不走直接生成视频捷径。

方案保存在canvas_workflow_proposals，刷新后可继续。编辑卡显示新增、删除、参数、位置及连接差异，可展开核对节点参数；应用只改节点，运行另行确认。运行控制绑定同一工作流版本及目标运行，生成费用和录制审批继续逐项确认。结果不确定的步骤不能由AI自行恢复或重放。

确认接口锁定方案记录，重复确认返回原回执；新建和运行使用同一请求标识，编辑使用精确版本并识别已成功的保存。过期、越权和版本冲突不会执行。HTTP重试已有请求直接返回原方案，避免重复模型规划。运行卡轮询实际步骤状态，完成结果沿既有素材、画布和聊天链路交付。

## 验证

- 隔离PostgreSQL工作流13项通过，包含AI编辑待确认、重复确认、跨用户访问、版本冲突、运行开关、暂停/继续、待核验阻断、过期和拒绝。
- 结构化规划器、工具注册和主提示词5项通过；Web操作卡及草稿7项通过。
- Chromium与Windows 0.2.21分别5条端到端通过（1.2分钟/1.4分钟），验证方案刷新保留、应用前不改节点/不运行、同一运行暂停和继续、录制仍待审批，以及原有节点/资源库/文稿流程。
- Shared构建与Server/Web类型检查通过，生产兼容Server类型检查通过。模型回包在隔离E2E使用确定性适配器；线上真实模型结果另行记录，不把适配器当真实推理证据。

新增迁移20261108000006_workflow_assistant仅创建提案记录及索引。前后端按生产现有版本增量发布，保留视频、登录、七牛云和当前未确认费用任务。

日志在M:/loomic-builds：workflow-ai-browser.log、workflow-ai-desktop.log、workflow-ai-production-types.log、workflow-ai-web-build.log。

## 线上真实模型与发布

`f9b052c` 已推送并增量发布。生产迁移 `20261108000006_workflow_assistant` 校验值为 `05c9aa2d4cd26da3378d770e89db6d9c13e49fc5475db3b747da03592003ec6a`；服务健康，未登录访问助手路由返回 401。该提交的 Website Capture、Agent Closure、Desktop Candidate 三项 CI 全部通过。

已在登录的生产画布请求真实模型搭建“网站录制到剪辑”：本站网址 → 最多录制一页 → 前五秒竖屏裁剪 → 输出到画布。模型返回四节点与三连接方案；点击“应用到画布”后提案状态为 applied，工作流修订为 3，active_goal_id 仍为空。验证记录为 `M:/loomic-builds/workflow-ai-production.log`。这次验证证明真实推理、预览确认及保存；没有启动该流程或调用收费图片/视频模型，原 0.16 积分待确认任务保持未批准。

## 节点操作层级

节点右键和 Shift+F10 使用原生工作区菜单，按“编辑节点、让 AI 修改、连接下一步、添加后续节点”排列。菜单展示节点名称与类型，输出节点不显示后续连接。AI 入口带上所选节点并聚焦对话输入，不自动发送或执行。

菜单浮于节点上方；生成与视频预览面板在菜单打开时暂时隐藏，关闭后恢复，保留未提交文本。Esc、外部点击、方向键与回焦由现有 Base UI 菜单处理。Windows 窄窗口聊天和节点菜单避让桌面标题栏，防止关闭按钮被遮挡。

`workflow-context-menu.spec.ts` 增加真实 Chromium/Electron 回归：修复前在“节点操作菜单可见”断言失败；修复后覆盖四入口、节点上下文、键盘、窄窗口、草稿恢复及无后台运行。Windows 0.2.21 候选版同时复查 AI 操作与节点拖拽；Web 工作树和生产候选类型检查、静态构建通过。候选构建使用的 Shared 符号已与类型声明对齐。

相关日志：`workflow-menu-before.log`、`workflow-menu-after.log`、`workflow-menu-desktop.log`、`workflow-menu-desktop-final.log`、`workflow-menu-types.log`、`workflow-menu-candidate-types.log`、`workflow-menu-web-build.log`。正式安装包的下一轮 CI 结果不等同于这次本地候选版验收。
