# 2026-11-15 浏览器 Cookie 与认证状态交错验收

本轮使用真实 Chromium、真实 HttpOnly Cookie 与实际 `AuthProvider`/`local-auth` 客户端，验证旧查询和旧登出响应的顺序。未使用生产服务器、真实账户、用户浏览器 profile 或数据库。

## 验收结构

`scripts/serve-auth-cookie-fixture.mjs` 用已有 Vite 将实际认证 provider 和客户端连同一个最小 React 控制页面编译到独立临时目录。HTTP 服务仅监听 `127.0.0.1:3001`，Cookie 通过实际响应头设置为 HttpOnly/SameSite=Lax。测试控制端点只控制请求何时返回，不模拟 React 状态或 Cookie jar。

三种隔离身份是固定测试名称 old/fresh/latest，不携带真实密码、令牌或用户数据。登录/登出的服务端业务由可控 fixture 替代，因此此测试验证浏览器 Set-Cookie 交错和客户端状态一致性，不冒充生产密码校验或服务器会话回收验收。

## 实际验证

1. 持有旧 session 查询，完成新登录并真实写入新 Cookie，再释放旧查询。界面和后续实际 session 请求都保持 fresh。
2. 持有旧登出响应，先完成 fresh 登录，确认浏览器实际 session 是 fresh；再让旧登出响应发送 `Max-Age=0`，确实清除浏览器 Cookie。新的 reconciliation 查询返回 null，界面显示 none，而不是继续假显示 fresh。
3. 再次交错旧登出与新登录，并持有登出后的 reconciliation 查询；随后完成 latest 登录，再释放旧 reconciliation。界面和实际 Cookie 查询都保持 latest，loading 结束，错误状态为空。

真实 Playwright **1/1 通过、零跳过、零 pageerror**。四个新增 fixture/spec/config/harness 文件通过 Biome。测试结束后 localhost:3001 无监听，没有创建或停止共享 PostgreSQL。

首次执行是 fixture 的 Vite ESM 入口选错导致构建前失败，修正为当前 Desktop 已安装 Vite 的 `dist/node/index.js` 后通过，没有修改产品依赖版本或安全选项。

## 证据与复验

- `.creative-test-results/auth-cookie-browser-20261115.log`
- `.creative-test-results/auth-cookie-browser.json`
- `.creative-test-results/auth-cookie-evidence-20261115.json`：HTTP 请求顺序与已测源文件 SHA-256。
- `.creative-test-results/auth-cookie-browser/.../auth-cookie-verified.png`

运行：

```powershell
pnpm --filter @helstera/web exec playwright test --config playwright.auth-cookie.config.ts
```

该 fixture 明确要求 3001 空闲；不复用未知现有服务，不杀其他进程。仅加载当前工作树的 provider/client，不依赖已生成 Next 输出。这个测试没有覆盖不同浏览器标签中的所有并发登录策略，也不证明生产 Cookie 域/HTTPS 配置已经上线。
