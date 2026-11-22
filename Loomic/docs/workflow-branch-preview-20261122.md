# IF / Switch 样本演算

继续 `codex/agent-workspace-ci`，远端基线 `749a256d`。本轮实现待办 HS-022。

在画布工作流中选择 IF 或 Switch 节点，展开“样本演算”，粘贴上游输出的 JSON 对象并点击“演算条件”。例如字段 `json.score` 可使用 `{"json":{"score":80}}`。结果显示命中出口、逐条条件、实际字段值和比较要求；字段缺失会明确标记。

IF 支持全部/任一条件。Switch 遵循出口顺序，支持首个命中、全部命中和默认出口。修改规则会重新计算已提交样本；修改样本会清除旧结果，防止误读。节点切换不会携带上一节点的样本。运行锁定时仍可演算，不能因此修改节点或发起运行。

演算仅在本机读取用户粘贴的样本，上限 24000 字，不调用模型、保存流程或创建任务。样本错误保留输入，提示修复；非法字段路径和出口设置被拒绝。预览与服务端执行共用 Shared 分支判断函数，服务端继续保留上游输出和原有审批门禁。

## 验证

- Shared 8 项、Web 8 项、Server 27 项通过，共 43 项；Server 包含真实隔离 PostgreSQL 的 19 项工作流回归。
- Chromium 3 项通过：Switch/批次检查点/版本恢复、48 节点导航、IF/分组/固定结果复用。演算后核对数据库，没有新增工作流运行或生成任务。
- IF 再次运行通过，覆盖 320 / 640 / 1700 像素下的输入边界、Tab 聚焦和 Enter 演算；320 和 1700 像素截图已目视检查。640 像素为窄视口检查，未宣称操作了浏览器原生 200% 缩放或完成读屏验收。
- Shared、Server、Web 类型检查通过；四个新增 TS/TSX 文件通过 Biome；`git diff --check` 通过。

浏览器命令：`pnpm --filter @helstera/web exec playwright test --config playwright.workflow.config.ts workflow-logic.spec.ts workflow-advanced.spec.ts`。使用本轮临时本地 PostgreSQL，测试结束后已停止。

截图与 Playwright 输出位于 `Loomic/.creative-test-results/`。最后一次 IF 窄屏复跑替换了该目录中的浏览器输出，三项完整回归的通过结果保留在本次聊天工具记录。临时数据库文件保留在 `D:/UserCache/Temp/loomic-branch-03bcaee195d145c79e661449342b68ff/pg`，目录清理被自动审批拦截。

## 发布

需要一起构建 Shared、Server 和 Web，避免服务端引用尚未发布的 Shared 导出。本轮没有数据库迁移，也没有新 API 或依赖。回滚时三个包一起恢复原版本。代码和验收记录为本地开发结果，生产发布单独处理。

后续可接 HS-021 上游字段选择器，或 HS-023 运行前阻断问题聚合。
