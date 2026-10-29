# Windows 免安装单文件启动设计

## 目标

为 Loomic Desktop 提供 Windows x64 单文件便携版：用户下载一个 EXE 后直接双击启动，不需要安装 Node.js、pnpm 或单独安装程序；ZIP 不再作为该交付形态。

## 现状与边界

当前 Electron Builder 同时生成 NSIS 安装包和 ZIP 便携包，发布脚本及文档也把 ZIP 作为便携版本。目标交付改为 Electron Builder `portable` target 生成的单个 EXE。NSIS 可保留为传统安装渠道，但不能冒充免安装版本。

“单文件”只约束交付物，不要求运行时完全不写磁盘。Electron 的可变配置、缓存和日志仍放在用户级目录；不写注册表、不创建安装目录、不依赖系统级安装权限。应用自身需要的 Electron runtime、前端产物和 Node 依赖都由 portable EXE 携带。

## 方案

### 打包配置

Windows x64 target 增加或改为 `portable`，产物名称显式包含 `portable`，避免与 NSIS 安装包混淆。portable 构建沿用现有 `dist`、`dist-electron`、asar unpack、图标和 Electron mirror 配置。发布构建仍使用 `--publish never`，上传阶段只发布 portable EXE 及其校验信息。

### 发布脚本

`release-desktop.py` 的 Windows 分支改为识别 portable EXE，并把它作为 `portableFileName` 和公开下载清单的目标文件。脚本不能再要求或猜测 ZIP；若构建没有生成恰好一个 portable EXE，应失败并给出明确错误。NSIS 若保留，作为独立 installer 字段处理，不改变 portable 字段语义。

### 应用数据与更新

便携版运行时使用用户目录保存配置、缓存和日志。自动更新必须避免直接覆盖当前正在运行的 portable EXE；如果现有更新机制不支持 portable 安全替换，便携版先提供手动下载更新或在退出后由辅助进程替换。不能宣称 portable 自动更新已可用，除非有真机证据。

### 发布文档

桌面发布文档改为说明：下载 portable EXE、双击启动、首次运行可能写入用户级数据目录；不再描述“解压 ZIP 后启动”作为目标交付。明确说明未签名 EXE 可能触发 Windows SmartScreen，签名状态必须独立验证。

## 错误处理

- 构建产物缺失、重复或命名不符合 portable 约定：发布脚本失败，不上传半成品。
- portable EXE 生成但哈希/大小清单缺失：发布失败，不更新公开 manifest。
- 运行所需用户目录无法创建：应用显示可操作错误并退出，不静默假装启动成功。
- 下载或更新失败：保留当前可运行版本，并显示失败原因；不删除现有版本。

## 验证标准

1. `electron-builder --win portable --x64 --publish never` 成功生成恰好一个 portable EXE。
2. 发布脚本的单元测试覆盖 portable 文件发现、命名、清单和缺失/重复失败路径。
3. 在没有 Node.js、pnpm 和 Loomic 安装项的 Windows 用户环境中，双击 EXE 能启动桌面窗口。
4. 启动后没有新增 Loomic 的系统安装项或卸载项；用户级配置/日志写入可预期目录。
5. 公开下载 manifest 记录 portable EXE 的名称、大小和 SHA-256；发布脚本在校验不一致时拒绝发布。
6. 文档和下载入口不再把 ZIP 标作目标便携交付。

## 不在本次范围

- 不实现新的自定义 bootstrap 下载器。
- 不把服务器、数据库或 API 密钥打包进客户端。
- 不承诺未验证的 portable 自动更新。
- 不删除传统 NSIS 安装渠道，除非后续单独决定。
