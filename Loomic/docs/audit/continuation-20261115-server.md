# 2026-11-15 Server 与 Shared 回归

验证目录是 `D:/qwq/项目/scpit/.codex-worktrees/Loomic-continuation-20261112/Loomic`。本轮未部署 API、Worker 或数据库迁移，不能从本地结果推断生产已修复。

## 修复

- 结算确认曾从同一任务的多个已确认报价中任取一条；旧报价没有工作流上下文时，会绕过实际出资报价的工作流预算。新增真实 PostgreSQL 用例先复现超预算确认错误成功，再将预算检查绑定到 `background_jobs.billing_approval_id`，与结算器的报价选择保持一致。预算不足保留原余额和待确认状态，扩充预算后仅结算原结果。
- 网页录制的画布交付已持久化成功或失败，但后台任务返回值仍保留 `pending`。交付函数现在返回已保存的状态，执行器写入相同状态；交付失败仍保留已完成录制，失败标记写入失败则保留原待处理回执。
- 快照预滚动等待浏览器完成两个绘制帧后再进入现有停留时间，避免忙碌时跳过懒加载观察回调。
- 录制测试使用和生产编码器相同的 FFmpeg 配置，明确报告启动错误；先关闭 BrowserContext 再关闭浏览器，确保 Windows 视频文件完成写入后清理。
- 修正动作生命周期测试过时的查询序号，保留任务状态、所有者和连接范围断言；执行器测试使用事务连接并验证交付失败不会删除成品。
- Agent Goal PostgreSQL 测试在关闭数据库池前 drain 所有测试 Hub，停止后台定时任务。修复后不再出现 `Cannot use a pool after calling end` 日志。

## 验证证据

- Shared 构建通过；8 个测试文件、205 项测试通过。
- Server TypeScript 检查通过，包括最后的结算与测试清理改动。
- 结算回归 36/36 通过；新增工作流预算用例修复前失败、修复后通过。
- Server 全套使用一次性本机 PostgreSQL 17、`--maxWorkers=4`：226 个文件通过，3 个文件跳过；1,169 项通过，24 项跳过，无失败，总计 1,193 项。
- 另启用可用环境补验 Agent Goal、真实 MP4 私有上传、OneTake FFmpeg 合成：21 项通过、1 项因缺 Electron 跳过。其中 1 项已在全套通过，故只新增覆盖 20 项，**合并覆盖为 1,189 项通过、4 项未执行，不能重复计为 1,190**。
- Hub 清理修复后单独重跑 Agent Goal：18 项通过、1 项跳过，日志无数据库池关闭后的后台重试。

命令采用 `node ../../node_modules/vitest/vitest.mjs run`；全套加 `--maxWorkers=4 --reporter=default --reporter=json`，补验加 `--maxWorkers=1`。使用测试进程环境变量传入随机密码的回环地址，不将凭据写入报告。

本地原始证据：

- `.creative-test-results/server-verified-20261115.json` 和 `.log`：全套终态。
- `.creative-test-results/server-supplement-20261115.json` 和 `.log`：补充环境测试；该次暴露测试 Hub 清理日志。
- `.creative-test-results/server-agent-goals-20261115.json` 和 `.log`：清理修复后的 Agent Goal 终态。
- `.creative-test-results/server-postgres-20261115.json` 和 `.log`：早期失败证据，不作为最终通过结果。

## 未执行边界

剩余 4 项分别依赖：真实 Electron 测试程序、OneTake 语音测试素材与转写运行时、显式开启的外网 example.com 录制、生成的部署 Shared 副本。未用关闭断言、延长超时或忽略失败来伪造这些验证。测试运行不证明生产媒体、上游账单或生产浏览器端到端可用。

## 临时数据库

本轮创建的集群仅监听 `127.0.0.1:64072`，使用随机 SCRAM 密码。结束时核验：测试数据库数 0，其他客户端连接数 0；仍有 2 个隔离测试 schema（此前失败测试遗留）。随后 `pg_ctl -m fast -w stop` 成功，集群已停止。

目录为 `D:/UserCache/Temp/helstera-server-verify-f5f100a461b6489bba10f2b73239ef35`。包含递归删除的清理命令被自动审批策略拒绝，仅返回 `blocked by policy`；未重试删除，目录仍保留。没有操作其他 PostgreSQL 服务或业务数据库。
