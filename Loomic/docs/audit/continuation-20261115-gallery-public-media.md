# 2026-11-15 Gallery 公开媒体入口

本轮补齐之前 Gallery feed 指向私有上传 URL、跨 workspace/匿名读者无法展示作品的产品缺口。没有发布真实作品或部署生产，没有放宽 `/api/uploads/:id/file` 权限。

## 实现

- 独立只读 `GET/HEAD /api/gallery/:galleryId/media`，Feed 的 `object_url` 指向该入口。
- 每次请求重新校验当前 publication、资产 active/删除/到期状态、同 workspace、generated/stored asset 作者与 publication owner 一致，以及 owner 仍为成员。
- Gallery 的列表、评论、点赞与媒体共用 publication owner/member 条件，避免媒体已撤销而其他公开信息继续显示。
- 只有安全的 PNG/JPEG/WebP/GIF/AVIF、MP4/WebM MIME 才可能响应，并检查文件头，拒绝 HTML/SVG/JS 或伪装为图片的活动内容。文件头检查不是全部格式解码或有效视频的保证。
- 存储根目录由 `app.ts` 显式传入已解析配置。路径字面与 `realpath` 均限制在根目录内，禁止 traversal 和外部 junction/symlink；只读取已核对的文件描述符，不退回无关 legacy 路径。
- ETag 从同一已打开文件的 stat 指纹生成，避免路径被替换后用新文件 ETag 发送旧文件字节。支持单范围、后缀范围、HEAD、有效/失效 `If-Range`。
- 所有响应包括 404、503、416 都先设 `no-store`；不利用 `If-None-Match` 返回跳过权限的 304。隐藏、删除、到期、purged 或 owner membership 撤销后的新 GET/HEAD/Range/条件请求均拒绝。已授权在途流或已下载内容不能被收回。
- 评论保存/删除响应额外返回当前事务持久化的 `comment_count`，重试同一请求返回相同权威计数，避免前端响应丢失后错误重复加减。

## 证据

新增真实 PostgreSQL 红测先出现 11 项失败（原公开媒体路由不存在、Feed 指向私有 URL）。修复后新媒体 21 项、Gallery 边界 21 项、私有资产原有 9 项，共 **51/51 通过**。这些使用隔离数据库、真实本地文件和 Fastify stream；图片 fixture 包含真实 PNG，其余安全格式头用于边界检查，不冒充所有容器的解码验收。

覆盖匿名与其他 workspace 读取明确发布作品、私有 upload 仍为 401/404、撤回后条件 GET/HEAD 404、精确范围内容、越界 416、旧 If-Range 完整响应、MIME/ownership 不匹配、HTML/SVG 伪装、链接/路径逃逸、匿名评论 `can_delete=false`、重复评论权威计数保持 1 和删除后 0。

5 个相关 gallery 文件 Biome 和 `git diff --check` 通过，Server TypeScript 检查通过。最终日志：`.creative-test-results/gallery-media-verified-20261115.log`；红测：`gallery-media-red-20261115.log`。

CI 需执行 `src/http/gallery-media.postgres.test.ts`，不能用未配置数据库时跳过当作通过。隔离 schema 已清理，集群交还 root 统一停止。本轮没有操作生产存储或旧测试集群。
