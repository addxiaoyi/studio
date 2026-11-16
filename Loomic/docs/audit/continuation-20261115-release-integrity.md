# 2026-11-15 r5 发布、迁移与导航边界

工作目录和基线沿用前轮。目标仍为继续完善项目；本轮没有生产部署、历史 SQL 重放、公开权限放宽或真实用户数据操作。

## 新修复

### 登录返回路径及工作区导航

原 `getSafeRedirect` 只检查斜线前缀，会放过 `'/\\outside.invalid/'` 以及包含换行/制表符的路径，浏览器 URL 规范化后可能离开本站。现在拒绝反斜线和控制字符，再解析成固定同源内部地址；合法画布 id、session 与片段保留。路径里的 `..` 正常规范化，查询中的外部 URL 字符串不会误判成目的地址。

工作区 layout 和真实 sidebar 在 `usePathname()` 尚未就绪时不再解引用 null；面包屑等待路径恢复，并容忍非法百分号编码，不因标签解析丢掉整个导航。9 项导航故障断言与 1 项真实 sidebar 组件回归先失败后修复；导航、登录、会话和面包屑定向 23/23 通过。

### Gallery 生命周期与交互

统一 published、未删除、active、未过期边界，隐藏/删除作品不再暴露评论或接受互动。上传 ID 发布不能复活软删除记录或延长保留期；私有素材收藏检查作者；评论幂等重放不能改写或复活旧评论；互动和计数使用一致事务。21 项真实 PostgreSQL 回归通过。详见 `continuation-20261115-gallery-boundary.md`。

公开 Gallery 卡片仍引用受保护的上传文件路径，跨工作区实际公开媒体展示尚需独立实现，未擅自扩大私有下载权限。

### 迁移并发和错误连接

迁移模块导入不再连库或执行 schema；直接 CLI 仍执行原流程。单个 PoolClient 的会话 advisory lock 覆盖 bootstrap 与完整增量链，多个部署者等待后重读版本，避免重复执行同一迁移。回滚或解锁失败的连接不会返回池；原错误及清理错误保留。最终 13/13 定向测试通过，包括 5 项真实数据库并发/回滚测试。

默认历史摘要漂移告警与显式严格模式语义保持不变，没有修改历史摘要。独立库入口的特殊跨 schema `search_path` 账本配置仍需调用方核验。详见 `continuation-20261115-migration-integrity.md`。

### 发布与回滚

发布前要求旧 API 与 Worker 的 ready 回执；停止前复核 PID/实例，停止后要求正常退出与同实例 drained。关键变更阶段重新读取 active pointer 与 Nginx，拒绝覆盖其他事务。回滚先恢复路由、排空候选 API，再交接 Worker，最后核验真实终态才报告 rolled_back。缺少进程身份的旧恢复上下文保留现场并拒绝自动停止。

完整测试曾出现一次 502，定位为 HTTP 夹具直接 terminate API 打断在途请求；夹具改为明确 drain，并增加跨越关闭阶段的 held 请求。换回强杀的对照在成功切流和回滚均稳定复现 502；优雅排空连续五轮全部 200。没有增加固定等待或删除可用性断言。详见 `continuation-20261115-release-rollback.md`。

## 测试发现与综合验证

- Web：859/859 单元测试通过，零跳过；类型检查通过；严格生产构建 68/68 页面成功。构建产物的实际 Chromium 提示词流程再验通过。
- Server：使用本轮一次性 PostgreSQL、4 worker 全套，234 文件通过、3 文件跳过；1,272 项通过、23 项专项环境跳过，无失败，总计 1,295 项。最后追加的迁移回滚连接小修通过 13 项迁移定向回归与最终 Server 类型检查；未把未重跑的整套数字说成最后一条代码后的全量执行。
- Server 跳过类别：AgentGoal 19（此前 18 已实测通过、真实 Electron 1 受宿主限制失败），真实 MP4 1、媒体合成 1、OneTake ASR 1、外网录制 1。MP4/合成/ASR 有独立补验证据，不与本次全套相加；外网录制未执行。
- 发布 Python：179 项运行，165 通过、14 平台/环境跳过。WSL 真实 Nginx 切流与故障回滚通过；不等于完整真实 PM2 业务/长 WebSocket 演练。
- 修复 Playwright 配置重复 workers 项；可选环境文件读取在文件存在时才执行，vendor 模板在实际用例内加载。清洁配置下 `playwright test --list` 从整体失败恢复为可列出 294 项/39 文件。这是发现验证，不是 294 项浏览器测试通过；需要 vendor/数据库/模型的具体用例仍要求真实依赖。
- CI 添加导航、迁移和 Gallery 回归。4 项 CI 配置测试通过；200 个引用测试路径实际存在。未推送或执行远端 CI。
- 本轮小型导航、迁移和 Gallery 文件分别通过 Biome，`git diff --check` 通过；全仓 lint 仍未清零。

原始日志：`.creative-test-results/web-navigation-full-20261115.json`、`server-full-r5-20261115.json`、`migration-final-verified-20261115.log`、`python-full-r5-verified-20261115.log`、`playwright-discovery-final-20261115.log`、`prompt-browser-r5-20261115.log`。

## r5 候选与终态

候选：`.codex-release/production-closure-20261115-r5.zip`。

166,509,337 字节，4,345 个条目；SHA-256：`83b6ffdce1cb2e18213c883c2644429a59a09a4a6c82e8c4d586072cbc8838c1`。

完整 manifest、路径、摘要和 Creative 运行时门禁通过，全部 Server 文件清单/内容与当前工作树核对一致。由 r5 ZIP 提取实际 208 个 Shared 文件后，递归一致性 6/6 通过。`.codex-release/LATEST.json` 已指向 r5，明确未部署。运行时继续采用之前核验的本地构建缓存，不声称本轮从 vendor 重建。发布 Python 脚本与 CI 改动在工作树，不因 Server/Web ZIP 自动更新生产发布工具。

临时 PostgreSQL 17 结束时用户 schema 0、其他连接 0，随后正常停止，55639 无监听，凭据文件删除。递归清理 `D:/UserCache/Temp/helstera-migration-gallery-vqkde0iy` 被自动审批拒绝，仅 `blocked by policy`；未重试，目录保留。

生产认证、图库 502、生产容量与历史迁移摘要核对、Electron 受限宿主中的真实 UI、跨工作区 Gallery 公开媒体，以及全仓源码质量仍未完成。没有用上述局部证据替代这些整体要求，目标保持 active。
