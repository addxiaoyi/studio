# 2026-11-15 排空错误传播

本轮只修改本地候选，没有重启或部署生产进程。

## 已复现缺陷

- `AgentGoalWorker.scan` 记录执行/锁释放异常后返回成功，`stop` 只能等待这个成功 Promise。即使停止期间释放 advisory lock 失败，ServiceLifecycle 仍可完成并写出 drained 回执。
- `GoalStepWorker` 停止时写入步骤恢复状态失败，被 task 的 catch 记录后吞掉；活动集合清空后 `stop` 同样返回成功。
- 独立队列运行器把未处理的执行异常交给日志后视为完成。任务已离开 active 集合时，随后的 stop 忘记未持久化结果，可以错误报告安全排空。
- App 内一个排空回调使用 `Promise.all`，错误传播一旦恢复，早期拒绝会跳过后续浏览器、事件发布器与连接清理。

新增回归先验证旧行为：Goal/Step 三项失败、Queue 两项失败，均为应拒绝却 resolve。证据在 `.creative-test-results/goal-drain-red-20261115.log` 和 `queue-drain-red-20261115.log`。

## 修复

Goal Worker 保留按 goal 关联的未解决工作错误，只有同 goal 后续真正取得锁并验证/处理成功才能清除；停机使重放跳过时不能清除。Step Worker 在中断状态或结果持久化失败时保留错误，没有领取到任务的后续扫描不能当作恢复。已安全保存为 failed 的业务结果仍可正常排空，纯轮询失败不会捏造活动任务。

QueueRunner 按队列保留首个未处理执行异常，避免无限堆积；它不具备验证持久化结果的能力，因此不会用后续无关任务成功清除旧故障。普通业务失败已由 executor 持久化并正常返回，不进入这个异常集合。停止后先等待全部 pump 与其他活动任务，再汇总执行和未执行 lease 释放错误；重复 stop 仍拒绝。故障实例不能伪造 drained，恢复需要核对任务状态并走新实例的既有恢复流程。

`drainInOrder` 每一阶段等待所有回调结算，继续执行后续清理，最后汇总异常。App 保持原来生产者→浏览器→事件→连接→缓冲区顺序。ServiceLifecycle 不会在某个同步错误后跳过其他回调。drained 回执仍只在整个排空成功后写入。

## 验证

- 7 个文件、43 项定向回归通过：Goal/Step worker drain、Goal worker、队列、生命周期、进程回执、健康检查、停机检查点。
- 新增边界包括：已退出 active 的失败不会被遗忘；失败与慢任务并存时仍等待慢任务；停止抢在重放前不能清除故障；步骤没有成功领取不能清除故障；正常中断恢复不被误拒绝；阶段失败仍执行后续清理。
- Server TypeScript 检查通过。
- 本轮 5 个小型生命周期/队列与回归文件 Biome 检查通过；未整体格式化大型 worker 或 app 文件。
- 没有新建 PostgreSQL 集群；测试使用明确控制异步结果的数据库接口夹具及实际 Worker/Lifecycle 实现。这验证错误传播与等待顺序，不替代生产长连接、真实供应商和系统崩溃演练。

最终日志：`.creative-test-results/goal-drain-verified-20261115.log`、`goal-drain-typecheck-20261115.log`。
