# Desktop Release

桌面端安装包由 GitHub Actions 在原生系统 runner 上构建，避免在 Linux 上交叉生成 Windows/macOS 安装包。

## 构建

推送 `desktop-v*` 标签，或在 Actions 手动运行 `Desktop Release`：

- Windows x64：NSIS 安装包
- macOS Intel：DMG
- macOS Apple Silicon：DMG
- Linux x64：AppImage

## 发布到服务器

`publish-server` job 需要仓库 Actions secrets：

- `HELT_DEPLOY_HOST`：生产服务器地址
- `HELT_DEPLOY_USER`：生产服务器用户
- `HELT_DEPLOY_PASSWORD`：生产服务器密码

构建产物会同步到 `/www/helstera/apps/web/out/downloads/`，下载页只引用 `studio.0st.top` 同源地址。当前 macOS 安装包未签名/公证，首次打开可能需要在系统安全设置中允许。
