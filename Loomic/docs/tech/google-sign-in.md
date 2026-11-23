# Google 账号登录

Google 登录沿用本地用户、工作区和 `helstera_session`。邮箱验证码和密码登录继续可用。

## 服务端配置

在 Google Cloud 创建「Web 应用」OAuth 客户端。正式环境授权 JavaScript 来源为 `https://studio.0st.top`，授权重定向 URI 必须精确匹配：

`https://studio.0st.top/api/local-auth/google/callback`

只在服务端环境文件设置 `GOOGLE_OAUTH_CLIENT_ID` 和 `GOOGLE_OAUTH_CLIENT_SECRET`。回调由 `HELSTERA_WEB_ORIGIN` 计算，不接受请求头提供的主机名；不要复用抖音使用的 `/auth/callback`。未配置时，邮箱登录可用且 Google 按钮隐藏。测试模式还需在 Google 控制台添加测试用户；对公众开放前应检查 OAuth 受众状态。

先执行 `20261123000000_google_sign_in.sql`，再启动 API。新增表记录短期登录状态与账号关联。迁移可重复执行，不改动现有积分、工程或用户表。

## 账号与隐私

仅申请 `openid email profile`，验证签名、受众、issuer、有效期、nonce、已验证邮箱和 subject。授权码采用 PKCE S256；state 一次消费、绑定浏览器，10 分钟有效。HTTPS cookie 使用 HttpOnly、Secure、SameSite=Lax。

Gmail 和 Google Workspace 托管的邮箱可关联本站同邮箱账号，保留原账号数据。Google 不管理的外部邮箱必须先通过本站邮箱登录或注册，再在「设置 → 个人资料」主动绑定。已绑定身份通过稳定 subject 找回用户，不按 Google 后续修改的邮箱合并其他账号。一个本站账号只允许一个 Google 身份；授权期间切换本站用户会使绑定失败。

不保存 Google access token 或 refresh token。Fastify 的 start/callback 路由关闭请求日志，异常日志仅包含错误分类。反向代理也必须屏蔽授权 URL：

```nginx
location ^~ /api/local-auth/google/ {
    access_log off;
    error_log /dev/null crit;
    proxy_pass http://127.0.0.1:3010;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 10s;
    proxy_read_timeout 60s;
    proxy_hide_header Referrer-Policy;
    add_header Referrer-Policy "no-referrer" always;
}
```

上游端口随 API 发布切换。该配置需在启用 Google 按钮前通过 `nginx -t` 并 reload。

## 验证

`GET /api/local-auth/providers` 返回是否配置和当前用户的绑定邮箱；响应禁止缓存。`/api/local-auth/google/start` 仅跳转 Google，不创建会话。缺少 state/cookie、取消、过期、重放与交换失败均不得登录。

本地自动化覆盖身份声明、路由、真实 PostgreSQL 并发及关联、原邮箱登录、前端加载/重试/错误提示。真实账号选择、Google 同意页和返回网站的用户会话仍需在浏览器验收；自动化测试不能替代该证据。
