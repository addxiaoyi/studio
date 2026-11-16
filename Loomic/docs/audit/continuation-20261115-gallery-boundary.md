# 2026-11-15 Gallery 与资产公开边界

本轮只修公开作品、评论、收藏和资产历史接口的边界，未改真实公开媒体存储授权，也没有生产数据操作。

## 已复现并修复

- 隐藏、移除、草稿 gallery 项目的评论读取和 like/comment 写入原先可以成功；现在统一要求 `published`、未删除、资产 active 且未过期。
- soft-deleted、purged、expired 资产原先可能继续出现在 feed 或通过上传对象 ID 重新 publish；现在发布和 feed 共用存活条件，发布不会恢复删除状态，也不会延长上传资产剩余保留期。
- 同 workspace 其他成员可收藏 private-video/private-try-on 资产；现在仅所有者可收藏私有资产。
- 相同 `requestId` 的评论重试原先会更新旧评论内容；现在只有相同正文才返回原记录，正文不同或已删除记录返回冲突，不会跨 gallery 修改。
- 评论计数、like 计数和收藏状态使用事务及行锁；计数写入失败回滚主写入，不泄露数据库异常。
- gallery 与 asset history 的 NaN、Infinity、负数、非整数和超范围分页在数据库前返回 400；gallery 尺寸字段只接受有限数字文本，异常 metadata 不会使 feed 失败。
- 评论、发布、like、收藏错误返回统一安全错误；匿名评论列表明确 `can_delete=false`。

红测中 16 项 PostgreSQL 边界用例有 15 项先失败；修复后 gallery 边界、原 local-growth 和 prompt catalog 合计 **42 项通过**，Server 直接 TypeScript 检查通过，三个新 gallery 文件 Biome 通过，diff check 通过。真实 PG 集群使用独立 schema；schema 已清除，集群仍由迁移审计代理管理。

## 未宣称完成的公开媒体边界

Gallery feed 的 `object_url` 继续指向受鉴权的 `/api/uploads/:id/file`。这保护了私有素材，但意味着跨 workspace 的公开 gallery 卡片不能在未认证请求中直接加载媒体。实现真正公开 gallery 媒体需要单独设计公开 manifest/对象 URL 与缓存策略，不能把私有上传接口随意放宽。本轮保留现状并记录为产品边界，未用测试假设掩盖。

## CI

将 `src/http/gallery-boundary.postgres.test.ts` 加入真实 PostgreSQL 资产/播放回归门禁。该文件不能在无 `HELT_TEST_DATABASE_URL` 时被误报为通过；完整环境运行仍依赖 CI 的 PostgreSQL service。
