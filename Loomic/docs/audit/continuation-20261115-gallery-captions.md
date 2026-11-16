# 2026-11-15 Gallery 显式字幕公开

本轮实现手动 WebVTT 字幕发布能力，不会自动读取 OneTake 私人转写或为无字幕视频伪造空 track。没有发布真实用户作品或部署生产。

## 已核对的来源边界

OneTake 的 `video_transcript_exports.compiled.captions` 是导出 revision/fingerprint 对应的冻结时间轴；现有 `/tasks/:id/subtitles` 则重编当前 edit，不能直接保证与以前保存的成片一致。资产的 `metadata.videoExportUploadId` 也可由普通上传 idempotency key 写入，不能单独证明可信 OneTake 来源。本轮采用用户主动选择 `.vtt`，不自动建立上述私有数据关联。

## 端到端实现

- 资产公开入口改为可取消的明确对话框。视频默认不选择字幕；选择后须提供 WebVTT 文件、语言和播放器标签，看到真实 cue 文字及时间预览，再点击“确认公开作品和字幕”。取消选择时发布请求不携带字幕内容。失败保留选择供重试。
- 只接受最多 256 KiB UTF-8、1–2000 个 cue、每 cue 1–2000 字、两小时内有序不重叠时间。支持常规 `HH:MM:SS.mmm` 和 `MM:SS.mmm`；不支持 STYLE、REGION 和定位设置。内容按纯文本转义，HTML/VTT markup 不直接执行。
- `publish` 的可选 `caption` 必须显式 `consent: true`。服务端重新校验并限制为 owner 当前可发布的视频资产，不依赖客户端预览。
- `gallery_items.caption_snapshot` 保存独立 publication 快照，不放入 `generated_assets.metadata`，不会被旧 feed metadata 展开意外披露。新增迁移 `20261115000000_gallery_captions.sql`；未选字幕的再次公开清除旧 caption 快照。
- 公开 `GET/HEAD /api/gallery/:galleryId/captions.vtt` 每次复核 published、资产有效、作者/成员和存储对象关系，返回 `text/vtt`、`no-store`、`nosniff`。隐藏、删除、到期、owner 变化后包括条件请求均拒绝；不通过 304 绕过撤回。
- Feed 只输出已选择的字幕 URL、语言和标签，字幕正文仅经受控 VTT 路由返回。Gallery 播放器仅在真实字幕存在时创建带实际 URL 的 track；外部 URL 不接受。
- Assets 页面按用户与 token 重建内容实例，避免同 token 换账号后保留旧私有列表与字幕对话框；后续旧请求导航/下载保护由独立 Assets 修复子任务补齐，见其记录。

## 验证证据

- Shared parser/serializer：9/9 通过，包含真实时间、UTF-8 大小、同意、重叠、markup 与不支持结构边界；Shared build 通过。
- 新字幕 PostgreSQL：8 项通过；与已有 Gallery/媒体 42 项合计 50/50。覆盖 owner 明确公开、未选择无字幕、peer 拒绝、图片不能加字幕、撤回/删除/到期/owner 不符拒绝、重复公开不继承隐藏字幕。迁移在隔离 schema 实际执行。
- 字幕对话框和播放器 5 项单元通过；与 Gallery 和 Assets 原回归首轮 16/16 通过。后续 same-token wrapper 与完整 Assets 异步保护由负责子任务再跑并记录，不简单叠加。
- Web typegen/tsc、68 页生产构建通过。最后 Assets 保护修改之后的整体构建交 root 重跑，不能将早一轮构建冒充最终所有源码产物。
- 真实 Chromium Gallery 回归 1/1 通过。owner 从实际 Assets 页面打开对话框，勾选默认关闭的字幕选项、上传真实 `.vtt`、选择语言/标签、查看 cue 预览并通过真实发布 API/PG 公开。peer 的实际构建播放器加载 `textTracks` 两个 cue，在 1.25 秒活动 cue 为 `Second caption`；语言 en、标签正确。撤回后 VTT 条件请求 404/no-store；原公开媒体、私有访问、320px 验收仍通过。
- 本轮 9 个 parser、路由、dialog、契约、测试/fixture 小文件 Biome 通过；GalleryMediaPreview 因未提供字幕的合法旧视频仍保留 `useMediaCaption` 诊断，没有用空 track、静音或关规则伪造全绿。

日志：`.creative-test-results/gallery-caption-pg-20261115.log`、`gallery-caption-web-20261115.log`、`gallery-caption-web-typecheck-final-20261115.log`、`web-build-captions-20261115.log`、`gallery-caption-consent-browser-20261115.log`。截图位于 `gallery-browser/.../gallery-caption-consent.png` 与 `gallery-built-mobile.png`。首次调用错误的 Next CLI 路径以及并行在途类型错误均修正后才确认通过；后续交接明确 final build 由 root 负责。

## 未宣称完成

这条能力接受 owner 主动提供且预览过的字幕，不验证其内容等同实际音轨，也不自动绑定/公开 OneTake 私有转写。只有具备真实字幕的作品可获得文字轨；普通无字幕作品仍有无障碍缺口。生产迁移、上线、真实外部访问和不同浏览器字幕呈现尚未验证。

测试只使用共享回环 PostgreSQL 50471 的独立 schema；本子任务 schema 已清理、3001 fixture 关闭，没有停止共享集群。root 负责最终集群停止和候选打包。Shared 输出已经变化，后续候选必须重新生成并核对副本，不能继续沿用 r6。
