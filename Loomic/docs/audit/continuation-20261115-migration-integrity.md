# 2026-11-15 迁移并发与模块边界

只修改本地 `apps/server/src/local-db/migrate.ts` 与直接回归测试，没有运行生产迁移、修改历史 SQL 或重写已经应用的校验和。

## 已复现问题

- 导入迁移模块会立即要求 `DATABASE_URL`、连接数据库并重放基础 schema；两个独立子进程回归分别在缺少连接和提供不可连接地址时复现，无法安全复用导出函数。
- 两个独立连接同时运行同一增量迁移，都先读取到没有版本记录并执行 SQL，后一个插入版本记录时冲突而失败。真实 PostgreSQL 回归通过独立阻塞锁固定并发边界，旧实现得到一个成功、一个失败，而非两个成功且仅执行一次。

## 修复

模块导入不再执行数据库操作；直接 CLI 仍要求连接变量并执行原有 schema 与增量流程。

迁移使用同一个 PoolClient，在数据库名和 schema 组合键上持有会话级 advisory lock，覆盖基础 schema 及整条增量链。每个增量文件仍在自己的事务中执行并记录摘要；其他部署者等待后重读应用记录，不会重复执行相同版本。

失败迁移回滚后释放锁。锁释放失败或结果不确定时销毁该池连接，避免把仍持有会话锁的连接放回池中；执行错误和释放错误同时发生时一起保留。回滚自身失败使用明确的 `MigrationRollbackError`，即便后续解锁成功，也不能把事务状态不明的连接返池；普通已成功回滚的业务错误不强制丢弃连接。基础 schema 创建也处于同一锁边界，`max: 1` 的池不因嵌套借连接而死锁。

校验和继续规范化 BOM 和 CRLF。既有默认策略仍是已应用摘要不符时明确告警并跳过该版本；`MIGRATION_STRICT_CHECKSUM=1` 仍拒绝漂移且不应用后续文件。两种模式均不会重放已应用 SQL、更新历史摘要或自动批准线上迁移。

## 验证

- 真实 PostgreSQL：5 项通过，覆盖同时运行只执行一次、bootstrap 并发、失败回滚及跨连接重试、默认漂移处理、严格拒绝后锁可释放。
- 模块/错误边界：6 项通过，覆盖无连接副作用的导入、CLI 缺少配置失败、跨平台摘要一致、执行与解锁双失败、回滚失败但解锁成功时丢弃连接。
- 原 schema 策略：2 项通过；最终合计 **13/13**。
- 本轮三个代码/测试文件 Biome 检查通过，限定文件的 `git diff --check` 通过。
- 并行 Gallery 测试类型修复后，重新执行整个 Server TypeScript 检查，退出 0。

证据：`.creative-test-results/migration-import-red-20261115.log`、`migration-concurrency-red-20261115.log`、`migration-rollback-red-20261115.log`、`migration-final-verified-20261115.log`、`migration-typecheck-20261115.log`。首次全 Server 检查遇到并行新增 Gallery 测试的临时类型错误，修复后才重新执行并确认通过。

测试使用本轮共享的回环 PostgreSQL 17，供迁移、Gallery 与父代理完整回归。全部测试结束后确认用户 schema 为 0、其他连接为 0，随后正常停止集群，55639 无监听、PID 文件消失，私有凭据文件已移除。删除 `D:/UserCache/Temp/helstera-migration-gallery-vqkde0iy` 的递归清理命令被自动审批拒绝，仅返回 `blocked by policy`，未重试删除，数据目录保留。

本地并发回归不代替生产 schema 漂移核对、容量门禁或在线迁移兼容性审查。

## 后续 search_path 账本范围修复

新真实 PostgreSQL 回归先复现两个入口的相同问题：自定义 `search_path` 的当前 schema 没有账本，但后续 schema 有 `schema_migrations`，迁移会向当前 schema 写数据、却把版本记进另一个 schema。原有按当前 schema 加锁不能保护这种共享账本。

现在获取会话锁后、执行 bootstrap 之前，先解析账本实际 namespace；已存在账本必须属于锁定的目标 schema，否则明确拒绝且不写入。bootstrap 无账本时仍允许正常创建。增量入口要求本 schema 已有账本，每个增量在执行前后再次核对 scope，账本 SELECT/INSERT 使用安全引用的目标 schema 限定名。基础 schema 现在显式置于事务内，若脚本改变 scope 导致提交条件不成立，已做 DDL 也会回滚；不会先提交结构再报告失败。

新增 5 项真实数据库回归：增量/基础入口拒绝 fallback、正确本地账本优先、增量切换 schema 回滚、基础脚本切换 schema 回滚。前两项和基础回滚均先红后绿。最终迁移相关 **18/18** 通过（10 项 PostgreSQL、6 项模块/错误边界、2 项原 schema 策略），Server 类型检查和三个文件 Biome 通过。旧的默认漂移告警及显式严格模式未变，没有自动迁移、复制或修改历史账本。

证据：`.creative-test-results/migration-scope-red-20261115.log`、`migration-bootstrap-scope-red-20261115.log`、`migration-scope-verified-20261115.log`、`migration-scope-typecheck-20261115.log`。

本轮使用新的共享回环 PostgreSQL 17，目录 `D:/UserCache/Temp/helstera-ledger-gallery-ip4q2ao1`、端口 61286，仅本机监听，public.pgcrypto 预建。迁移测试使用独立 schema 并全部清理；集群仍供 Gallery 和父代理验证使用，最终停止由父代理负责，连接凭据未写入记录。原先已停止的 55639 集群未重用、未重试删除。
