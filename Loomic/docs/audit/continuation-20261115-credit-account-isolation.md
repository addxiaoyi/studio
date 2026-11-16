# 2026-11-15 积分账户隔离与真实分页

本轮修复余额和用量历史的账户切换/异步响应，以及实际无法加载 100 条之后流水的 API 合约。没有改动真实余额、支付配置或生产数据。

## 已复现问题

- 余额慢响应和错误未关联用户身份，旧账户响应可以覆盖新账户。退出登录后仍显示原余额；重叠刷新旧请求会提前结束新请求的 loading。
- 用量历史只在挂载时读取。会话稍后到达或账户切换都不重新请求，旧流水可能长期留在界面。
- 本地认证 token 固定为 `local-session`，只以 token 区分请求仍不足以隔离账户；修复使用用户 ID 与 token 组合身份。
- 历史前端请求 365 条，服务端上限 100，前端以返回 365 条才显示 Load More，因此真正使用中无法加载第 101 条。服务端也没有 offset，增大 limit 不构成分页。
- 加载更多失败时原已显示流水被错误面板完全替换，重试退回第一页，过滤器没有匹配项时也不能访问更旧的匹配记录。

前端原实现 6 条回归全部失败；另增加同 token 不同用户与过滤后继续加载两条边界。后端真实 PostgreSQL 105 条流水、相同时间戳和另一个工作区的夹具，原分页逻辑 10 项失败、1 项通过。

## 修复

余额结果携带用户 ID/token 身份，渲染时直接屏蔽不属于当前身份的旧 snapshot；请求代次及身份检查同时阻止旧成功、旧错误和提前结束 loading。账户变化与卸载失效旧请求，正常同账户后台刷新保留已知余额。

历史组件按身份独立挂载；新身份、退出登录立即清空数据和本地过滤/加载状态。加载更多同步加锁，按页追加去重；失败保留原页，重试同一 offset，过滤器无匹配时仍可继续加载。

`GET /api/credits/transactions` 新增 offset 与 pagination，外部每页最多 100，拒绝非法整数、负值、重复参数及超过上限的分页。服务端内部取 limit+1 判断真实下一页，使用 created_at/id 排序处理时间戳平局，并始终限定当前认证工作区。响应 `private, no-store`。本地与旧远程适配器均支持该偏移参数；旧调用不传 offset 时默认 0。前端每页 100，并用服务端 hasMore 判断是否继续，不再增大受限的 limit。

这是 offset 分页，不是跨并发账本插入/清理的冻结快照；前端按事务 ID 去重，不宣称动态数据集中的所有页面构成同一时刻账本快照。热图文字明确基于已加载流水，避免把首批记录视为完整 12 周活动。

## 验证

- 前端账户/分页 8 项，原 usage 2 项、header 1 项、billing 2 项，共 13/13 通过。
- 真实 PostgreSQL 分页 11/11，通过全部 105 条跨页、相同时间排序、工作区隔离、整页末尾 hasMore=false、非法查询及认证。
- Server 类型检查通过；Web 首次类型检查仅遇到并行字幕模块的在途错误，不将其记为通过，最终合并结果由父代理记录。
- 本轮余额 hook、历史组件、新账户回归及新 PG 回归四文件 Biome 通过；没有整体格式化大型 credit 服务或关闭规则。
- 共享 PostgreSQL 由 auth 子任务提供，仅创建/删除 `credit_pagination_*` schema；未停止共享服务、未触碰旧测试集群。

证据：`.creative-test-results/credit-account-red-20261115.log`、`credit-account-verified-20261115.log`、`credit-pagination-red-20261115.log`、`credit-pagination-green-20261115.log`、`credit-server-typecheck-20261115.log`。

CI 应增加 Web `credit-account-isolation.test.tsx` 与实际 PostgreSQL `credit-pagination.postgres.test.ts`。修复尚未部署，旧候选需要重新生成后才包含当前分页与身份边界。
