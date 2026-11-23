# Google 登录发布与验收

2026-11-23（Asia/Shanghai）。代码 `c5b98e23db162de3559db12e1f59bc79449d2248` 已推送至 `codex/agent-workspace-ci`，20:16 正式切换。

## 正式环境

- API：`0.0.0-google-20261123`，`127.0.0.1:3010`，PM2 `helstera-google-server-20261123`；数据库、存储与接流 readiness 均通过。
- Worker 继续运行 `helstera-kuaipao-worker-20261123`。两者重启计数均为 0。
- 发布包 1,047 个文件，SHA-256 `5093887231935eb640cec24e181837d84f2af1f93060f27c5916d92684ef9b24`。正式 login、settings、privacy、home、image、video 页面均 HTTP 200 且与发布文件摘要一致；保留 53 个下载文件和 72 个旧版静态块。
- 应用迁移 `20261123000000_google_sign_in`，checksum `f94423bd7c745a78ec7517bec317cfc647d485da009d5965b067a3687d733a5b`。未改写历史迁移。
- Google 客户端原回调尾部误含 `%60`；在控制台改为 `https://studio.0st.top/api/local-auth/google/callback` 后已保存，真实跳转不再出现 `redirect_uri_mismatch`。
- 客户端密钥仅位于服务器环境文件，权限 0600；未提交源码或打入前端。专用 Nginx OAuth 路由屏蔽访问日志，测试回调标识未出现在 API 或 Nginx 日志中。

## 验收证据

- 服务端身份、路由、真实 PostgreSQL、原密码和邮箱注册：36 项通过。
- Google 按钮、重试、绑定、取消提示与原登录/个人资料：16 项通过。
- Server 类型检查通过；隔离 Web 构建与该构建的 TypeScript 检查通过。主工作区残留的 `.next`/`.next-dev` 文档路由类型不用于发布校验。
- 新增 9 个 TypeScript 文件通过 Biome。52 项相关测试均在最终代码执行成功。
- CI：Website Capture `45171091053`、Desktop Candidate `45171091095`、Agent Closure `45171091048` 全部成功；后者包含数据库/合同和完整浏览器两组。
- 正式 `/api/local-auth/providers` 启用 Google；授权地址包含固定 callback、最小 scopes 和 PKCE S256，cookie 为 Secure/HttpOnly。取消、缺少 state、消费后重放、匿名绑定均被拒绝且不创建会话。
- 正式登录页在 390×844 和 1280×800 检查：Google 按钮可用，取消提示保留，移动端无横向溢出。
- 用户确认完成绑定，服务器核实 20:36:12 新增一条 Google 身份关联和有效会话。关联账号创建于 2026-09-08，原工作区 1 个、项目 671 个、余额 897.8220 积分。没有创建替代原账号的新用户。本轮未执行付费生成或充值。

真实 Google 令牌交换、身份绑定与本站会话创建已验证。单独退出后再次点击 Google 登录、Google 新用户注册，以及 Google 受众对所有外部账号开放的状态，尚未额外实测；不以本次绑定替代这些结论。

## 备份与回退

发布前生成 2,015,814,428 字节 PostgreSQL custom dump，权限 0600。默认恢复工具版本不匹配，使用 `/usr/lib/postgresql/18/bin/pg_restore --list` 校验通过；本次备份尚未做全库恢复演练。

旧 API 3009 和旧静态目录 `/www/helstera/.releases/google-20261123/apps/web/out` 保留。Nginx 备份位于 `/www/helstera/.ops-google-20261123/nginx-before-google.conf`；切回前检查配置及 release marker，执行 `nginx -t`。新增表可保留，旧 API 不依赖它们。

生产证据：`/www/helstera/.ops-google-20261123/`；本地证据：`M:/loomic-builds/launch-20261123/google-*.json` 和登录页截图。临时凭据只使用 Windows DPAPI，收尾删除；仓库不记录任何凭据。
