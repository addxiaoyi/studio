# 2026-11-15 r6 Gallery 媒体与交互闭环

本轮完成本地公开 Gallery 媒体和交互恢复缺口，并修复自定义 search_path 的迁移账本范围。没有发布真实作品、调用生产付费模型或部署生产。整体“继续完善项目”目标仍在进行。

## 公开媒体边界

新增独立只读 `GET/HEAD /api/gallery/:galleryId/media`；feed 使用 Gallery ID 生成媒体 URL，不再依赖私有上传地址给其他工作区展示作品。每次请求验证当前 published/未删除、资产 active/未过期、同 workspace、作者和 publication owner 一致、发布者仍为成员。列表、评论、点赞与媒体使用同一公开条件。

原私有 `/api/uploads/:id/file` 权限未放宽。发布撤回后新的 GET、HEAD、Range 和条件请求拒绝；不声称可以收回已下载或已开始发送的内容。所有响应 no-store，不用 304 绕过授权。

存储根目录显式传入；真实路径及打开文件身份必须匹配，只允许安全媒体 MIME 和对应文件头。流与 ETag 来自同一已打开文件。支持单范围和 If-Range；HTML/SVG/伪装类型、路径越界和作者不一致拒绝。细节见 `continuation-20261115-gallery-public-media.md`。

## 前端恢复与并发

Gallery 数据边界、请求状态与媒体预览拆为独立小模块。作品加载失败与空列表分开，保留重试；讨论加载失败与空评论分开。每张作品独立同步锁定操作，不会因另一张卡完成而提前解锁；同卡讨论读取与修改串行，避免旧 GET 覆盖新评论。

评论提交响应丢失后复用原 requestId，保留草稿。服务端保存/删除返回事务中的权威 comment_count；旧服务省略该字段时只刷新当前卡计数，不用客户端增量猜测。新增“丢响应→刷新列表→重试”验证计数仍为 1。删除结果不明时可刷新讨论核对。

账户切换使用独立组件生命周期，旧请求中止且迟到成功/失败不写入新账户视图。异常日期显示“时间未知”，不崩溃。评论按钮/输入框有可访问名称，媒体读取失败提供重试并保留讨论。没有添加空字幕轨绕过 lint；真实视频字幕资源仍是未完成的可访问性项。

## 迁移账本范围

若 current_schema 无本地账本、search_path 后续 schema 存在 schema_migrations，原实现会在一个 schema 执行 SQL、另一个 schema 记录版本。现在锁后且 bootstrap 前核对实际账本 namespace；增量账本读取/写入显式限定目标 schema，并在执行前后复核范围。bootstrap 也置于事务，非法改变范围会回滚结构变更。18/18 定向回归通过；历史摘要漂移策略未变。详见迁移审计记录。

## 验证与实际浏览器

- Server 全套使用临时 PostgreSQL：235 文件通过、3 文件跳过；1,300 项通过、23 项专项环境跳过，零失败。详见 `server-full-r6-20261115.json`；此前 OneTake/媒体/Electron 补验分别记录，不重复相加。
- 新媒体 21 项、Gallery 边界 21 项、私有资产 9 项，共 51/51 定向通过。
- Web 全套 866/866 通过。之后增加删除响应丢失恢复用例及刷新按钮，最终 Gallery 定向 9/9 通过；不把两轮数字相加。
- 最终严格 Web 构建 68/68 页面成功，独立 Web/Server 类型检查通过。早期曾并行运行 Next typegen/build 导致中间生成文件缺失，随后顺序验证成功；未忽略类型错误。
- 真实 Chromium 1/1 通过：生产 Gallery 路由和真实 PostgreSQL 发布 320×180 PNG、160×120/2 秒 MP4，匿名 Image.decode 和视频播放时间推进成功；字节与原文件 SHA-256 一致，HEAD 与匹配 If-Range/Range 响应通过。旧 If-Range 完整响应另由 PG 路由回归验证。
- 第二账户实际构建页面完成列表 503 重试、实际 SQL 点赞、媒体显示和 320px 无横向溢出。撤回后匿名 GET/HEAD/Range 404，私有下载匿名 401/其他账户 404，owner 私有读取仍 200。
- fixture 只替换认证入口为隔离测试身份；发布、授权、计数 SQL 和媒体流均实际执行。图片由 sharp、视频由 FFmpeg 生成；没有上传或公开真实外部数据。
- 最初自定义测试域名被本机代理接管而返回 502，改为已确认空闲的 localhost:3001 后通过；没有修改系统代理或禁用浏览器保护。测试结束删除独立 schema、关闭 3001。
- Gallery 数据/交互/测试五文件 Biome 通过；媒体预览仍有真实字幕缺失诊断，全仓 lint 未清零。CI 已加入新 PG、UI 回归以及独立公开媒体浏览器流程，配置回归通过，未推送到远端。

证据：`.creative-test-results/gallery-browser-evidence-20261115.json`、`gallery-browser-real-20261115.log`、`gallery-browser/.../gallery-built-mobile.png`、`gallery-ui-final-20261115.log`、`web-gallery-full-20261115.json`、`server-full-r6-20261115.json`。浏览器记录另见 `continuation-20261115-gallery-browser.md`。

## r6 候选与环境终态

候选 `.codex-release/production-closure-20261115-r6.zip`：166,522,222 字节、4,348 条目。

SHA-256：`a4dcf50749d6cdcca30215cce7053ec3aae568ffe314ce4f2ef54e8ee21a2981`。

完整 manifest/路径/哈希/Creative 运行时门禁通过；全部 Server 文件清单与工作树逐字节一致。实际 ZIP 的 208 个 Shared 文件独立提取后，递归 parity 6/6 通过。LATEST.json 指向 r6 并明确未部署。运行时依然使用此前核验的本地构建缓存，不冒充本轮 vendor 重建。

本轮 PostgreSQL 17 使用 `D:/UserCache/Temp/helstera-ledger-gallery-ip4q2ao1`、回环端口 61286。结束时用户 schema 0、其他连接 0；随后正常停止，PID 文件和端口监听消失，私有凭据文件已移除。递归清理该数据目录被自动审批拒绝，仅返回 `blocked by policy`，未重试删除，目录保留。

生产认证未提供，因此服装图库 Qiniu 502、真实生产容量/迁移与发布条件未闭环。本轮 Gallery 公共媒体是独立产品功能，不能据此声称生产 Qiniu 故障已修复。Electron 宿主权限、字幕资源、全仓源码质量及其他端到端边界仍需继续。
