# 2026-11-15 作品库真实媒体浏览器验收

本轮使用单独的 loopback PostgreSQL schema、隔离 Fastify fixture 和独立 Chromium context。没有复用用户浏览器 profile、没有请求外部站点、没有部署或操作真实生产媒体。

## 验收范围

测试通过真实 `registerGalleryRoutes`、`registerGalleryMediaRoutes`、`registerLocalAssetRoutes` 及 PostgreSQL SQL：

- 生成 320×180 PNG 和 160×120、2 秒 MP4；通过实际发布接口公开，不直接插入 gallery 状态。
- 另一账户的发布操作返回 404；匿名请求读取公开图片和视频。
- Chromium `Image.decode()` 得到 320×180；`HTMLVideoElement` loadeddata、实际播放推进到 0.26 秒，得到 160×120、2 秒媒体。
- API full GET 字节 SHA-256 与 fixture 文件一致；HEAD 内容长度正确；带匹配 If-Range 的 Range 0–15 返回 206 正确片段。
- 私有上传匿名返回 401，另一账户返回 404；公开媒体仍可被匿名读取。
- 320px 页面截图验证公开作品在真实浏览器中加载，无横向溢出；点赞通过真实 API 更新计数。
- 先让作品列表 API 返回 503，页面显示可重试错误；点击重试后真实读取两个作品。
- 撤回接口由 owner 执行后，匿名 GET、HEAD、Range 全部 404 且 no-store；owner 的私有上传仍可读取。撤回后的列表为空。

业务 SQL 没有 mock，媒体字节由真实文件和 ffmpeg/sharp 生成。证据 JSON：`.creative-test-results/gallery-browser-evidence-20261115.json`；真实浏览器日志：`.creative-test-results/gallery-browser-real-20261115.log`。

截图：

- `.creative-test-results/gallery-browser/.../gallery-anonymous-decoded.png`
- `.creative-test-results/gallery-browser/.../gallery-built-mobile.png`

截图摘要：真实 PNG/视频页面渲染、手机宽度作品列表和点赞前后布局；SHA-256/尺寸/播放时间在证据 JSON 中记录。

## 终态

浏览器 fixture 进程已退出，端口 3001 已关闭；fixture 自有 PostgreSQL schema 数为 0，未停止共享测试数据库。测试用的 `D:/UserCache/Temp/helstera-ledger-gallery-ip4q2ao1/test-runtime.json` 连接仍归父任务管理。未创建或修改生产对象。

该验收证明当前 Gallery 路由、撤回和媒体播放实现可用，不证明公网 Qiniu 502 已修复，也不证明生产发布已完成。
