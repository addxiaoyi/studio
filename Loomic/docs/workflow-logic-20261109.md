# 双击编辑、分支节点与固定结果

卡片单击只选择，不打开或切换节点设置；拖拽、缩放和框选同样不打开设置。双击、Enter/F2、明确的“编辑”按钮与侧栏节点列表仍可打开参数。工作流交互回归已增加单击保持面板关闭、双击打开的断言。

新增七类实际可执行节点：IF 条件分支、JSON 数据、字段提取、文本处理、文本模板、合并文本、等待。文本模板仅替换 `{{text}}`，不执行脚本；字段路径禁止原型链访问，处理结果有长度上限；等待记录恢复时间，不占用长时间阻塞任务。

IF 支持全部/任一条件，比较非空、相等、不等、包含、大于、小于。出边记录“是/否”，节点端口、输入连线和 AI 计划保留该信息。执行器在审批、生成调用之前跳过未命中的分支；跳过回执写入步骤日志，后续分支继续跳过，合并和交付仅接收已命中输入。不会把跳过展示为实际生成成功。

节点可固定同一工作流、同一节点的成功回执。保存、开始运行及执行期间校验配置匹配、所有权、素材有效期。固定后剪除不再需要的上游，使用 `result.pinned`，不调用原生成器；取消固定恢复正常运行。网址、搜索、IF、等待、交付不能固定，IF 下游也不能借固定绕过条件。模板导出、跨流程实例化和复制节点不继承固定权限。

节点备注、分组名称、分组备注和折叠状态持久保存。折叠隐藏内部卡片，保留图结构与对外连接；展开恢复原节点，拖动分组同步位置。普通画布素材仍保留，避免折叠导致运行时素材权限校验误认为素材已删除。分组来自多选节点，可取消分组而保留节点。

## 验证

- `87cd824` 的 Desktop Candidate 和 Website Capture CI 成功；Agent Closure 失败于窄屏测试的可见性检查和点击之间面板被响应式关闭。改成切换窗口尺寸前关闭聊天并等待关闭，不降低输入区/历史区域可见性断言。
- Shared 新旧流程、条件校验、固定结果剪枝、模板权限共 16 项通过；Web 场景与组件 17 项通过；服务执行器与权限 4 项通过。
- 隔离 PostgreSQL 16 项通过，新增未命中生成节点 attempt=0、不调用执行器；固定已验证生成结果后再次运行只调用固定结果与交付；配置变化和失效素材拒绝执行。
- Chromium 真实逻辑链路通过（52.8 秒），覆盖分组折叠保存、刷新、备注、IF→文本→合并→等待→交付与固定后再运行。Windows 0.2.21 隔离候选完整工作流 12 项通过（3.2 分钟），包含旧素材引用、拖动、撤销、恢复、节点菜单及 AI 方案。
- Shared 构建，Server/Web/Desktop 类型检查通过；Desktop 使用 `tsconfig.electron.json`。最后的字数限制和防循环补充后，数据库16项、场景11项、执行器/规划器4项再次通过。固定状态回归3项通过：下游即使继承回执字段，也必须实际使用 `result.pinned` 才显示“复用固定结果”。

日志保存在 `M:/loomic-builds/`：`workflow-87cd-ci-failure.log`、`workflow-doubleclick.log`、`workflow-logic-shared.log`、`workflow-logic-web-unit.log`、`workflow-logic-postgres.log`、`workflow-logic-browser.log`、`workflow-logic-desktop.log`。本轮无新增数据库表或删除迁移，现有 JSON 图和步骤回执兼容扩展。

## 生产验收与发布

2026-11-09 已发布 `ca3ffdd` 的功能改动及 `aebd837` 的固定状态修正。按生产现有基线合入，保留视频、登录与七牛云已有改动；Server/Shared 校验79个文件，Web 更新163个文件并校验3251个文件。服务端和 Worker 均为 online，健康接口返回 `ok:true`；画布、视频、女装与桌面入口返回200。

生产画布 HTML SHA256：`ff50c1ac48da168eb0da0424eee8510172c3f5808803b99e02eaad1436d331f1`。部署与核验日志：`workflow-logic-deploy.log`、`workflow-logic-publish.log`、`workflow-logic-production.log`。本轮未调用付费图片或视频生成。

在生产用户画布中创建独立的“IF 分支与固定结果验收”流程（`41a9ea6d-7d0a-45b3-a0d3-1c2ce8cc3280`），真实 AI 返回结构化修改方案，确认后应用。图有7节点7连线，内容为 `hello → IF → 大写/备用模板 → 合并 → 等待1秒 → 交付`。

- 首次运行 `70bce216-6a89-410d-b3a5-d285bd48534d` 完成；是分支输出 `HELLO`，否分支 `attempt=0` 且 `skipped=true`。
- 固定创作资料后，第二次运行 `2ebe0647-28b4-46fb-b02b-0ec074892ff2` 完成；资料步骤执行器为 `result.pinned`，IF 仍实际执行，否分支仍零次调用，最终输出 `HELLO`。
- 真实浏览器单击卡片时设置面板保持关闭，双击打开 IF 条件设置。分组折叠保存并刷新后，仍显示7节点7连线和折叠的“输入与判断”；运行历史保留两次成功回执。
- 第二次运行的界面显示“复用固定结果”“已跳过”“全部完成”，与数据库执行器和尝试次数一致。生产截图保存在 `M:/loomic-builds/workflow-logic-production.png`。

## GitHub CI

代码提交 `aebd837f14f21f10634948f0f5faa1bed880bd1f`：

- [Agent Closure 42542149617](https://github.com/addxiaoyi/studio/actions/runs/42542149617)：success；contracts-and-database 与 editor-browser 均成功。
- [Desktop Candidate 42542149671](https://github.com/addxiaoyi/studio/actions/runs/42542149671)：success；Windows video tools、Windows x64、Linux x64、macOS arm64 均成功。
- 主功能提交 `ca3ffdd593f2c1dd8ec76d9e339145674ca98cc4` 的 [Website Capture 42541996887](https://github.com/addxiaoyi/studio/actions/runs/42541996887)：success。后续 `aebd837` 仅修正工作流固定状态判定及回归测试。

完整运行元数据保存在 `M:/loomic-builds/workflow-logic-ci-<runId>.json`。跨平台 CI 构建成功与本地 Windows 12项运行验收分别记录；未据此声称已在 macOS/Linux 真机操作本轮界面。

## 参考与边界

基于 [n8n IF](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if/) 和 [固定数据的调试用途](https://docs.n8n.io/build/understand-workflows/understand-executions/types-of-executions.md) 独立实现。本站的固定结果来自可核验的私有历史回执，不导入第三方任意 JSON 作为执行成功证据。当前无 HTTP 任意请求、脚本执行、定时触发等额外能力。
