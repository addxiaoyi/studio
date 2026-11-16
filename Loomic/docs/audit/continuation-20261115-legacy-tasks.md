# 2026-11-15 旧任务接口权限与重试边界

工作目录沿用 `Loomic-continuation-20261112/Loomic`。本轮没有生产部署、真实模型执行、扣费或业务任务重试。

## 已复现问题

`local-growth.ts` 的旧 `/api/tasks/:jobId`、`/export`、`/retry` 只限制 workspace，没有按任务作者隔离。同一工作区其他成员可以读取和导出另一人的提示词、供应商任务信息，还能将其失败任务改为 queued。规范 `/api/jobs` 的读取服务按 `created_by` 隔离，旧入口绕过了这一边界。

旧 retry 直接更新队列行，不检查生成报价、账本退款、未知供应商结果、录制重新授权或内容工作流状态。真实 PostgreSQL 回归确认：已经有退款账本的图片/视频失败任务，旧端点第一次返回 200 并重新排队；并发后续请求才返回 409。非法 UUID 直接触发数据库错误并返回 500。

先运行新的真实数据库回归验证旧代码，12 项中 11 项失败、1 项通过；保存于 `.creative-test-results/legacy-tasks-red-20261115.log`。这不是仅通过 SQL 文本匹配的夹具。

## 修复

- 三个旧接口提取到 `http/legacy-tasks.ts`，通过原 `registerLocalGrowthRoutes` 注册，不复制费用或工作流执行逻辑。
- 所有读取和恢复查询要求当前 workspace 与任务 `created_by` 同时匹配。成员身份不再授予读取另一人任务的能力。
- 验证 UUID；未登录返回 401，非法标识返回 400，无权限或不存在返回 404；结果使用 `private, no-store`。
- GET 返回明确的任务字段，导出保留原 JSON 形状；不再 `select *` 暴露所有内部数据库列。
- 旧 retry 不再重新排队。失败/结果同步任务返回 409 `task_recovery_required` 与已存在的受支持恢复入口：生成重新提交并核对报价、已有产物 `/sync`、本人网站任务专属 retry、本人内容自动化 retry。其他状态返回 409 `task_not_retryable`。
- 恢复入口仅为说明，不自动重放请求、提交模型或变更账本。网站与内容关联也校验 workspace/作者；错误或缺失关联不泄露其他任务 ID。

仓库内未发现前端调用这三个旧接口。旧 retry 的行为是有意收紧，外部旧客户端需按返回的恢复信息进入原业务流程，不能继续依赖直接改队列状态。

## 验证

- 14 项真实 PostgreSQL 回归通过，包括跨成员 GET/export/retry 拒绝、当前 workspace 限制、所有者导出、UUID 和认证、图片/视频退款任务并发重试状态与账本完全不变、产物同步入口、网站与内容恢复入口、外来关联隐藏、活动/终态不可重新排队。
- 原 `local-growth.test.ts` 3 项保持通过，合计 17/17；证据 `.creative-test-results/legacy-tasks-green-20261115.log`。
- 新增两个代码/测试文件 Biome 检查通过，`git diff --check` 通过；Server TypeScript 检查通过（最终日志 `.creative-test-results/legacy-tasks-typecheck-20261115.log`）。
- 使用 root 创建的临时 PostgreSQL 17，测试只创建并删除自己的 `legacy_tasks_*` schema。未停止共享测试集群或删除其目录，集群生命周期由 root 统一处理。

没有验证生产是否曾存在跨账户访问或旧端点重排记录；本轮代码修复不代表生产已上线。
