# Helstera 本机浏览器助手 0.2.0

扩展将当前 Edge/Chrome 浏览器配置连接到 Helstera Desktop。配对使用一次性代码，十分钟后过期。扩展不会读取 Cookie、密码、OTP 或浏览器存储。

## Edge 安装

1. 将扩展 ZIP 解压到固定的本机目录。
2. 打开 `edge://extensions` 并启用“开发人员模式”。
3. 选择“加载解压缩的扩展”，指定包含 `manifest.json` 的目录。
4. 回到 Helstera Desktop，选择“授权的 Edge / Chrome 标签页”，再点“一键连接浏览器”。
5. 配对前先在 Edge 中打开并停留在目标网页，再切回桌面端。连接确认后，临时配对页会关闭并恢复原活动标签。

## Chrome 安装

在 Chrome 中打开 `chrome://extensions`，按 Edge 的相同步骤加载扩展。

扩展请求 HTTP/HTTPS 页面权限，以便读取当前活动标签页并执行任务授权范围内的浏览器操作。只连接可信的浏览器配置；完成后可在桌面端断开或撤销连接。
