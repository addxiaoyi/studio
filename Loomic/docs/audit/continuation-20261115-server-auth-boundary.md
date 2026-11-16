# 2026-11-15 Server 认证边界

本轮只修本地认证代码和隔离测试，未重置真实账户密码、轮换凭据、撤销生产会话或部署。

## 已复现问题

- `reset-password` 先调用验证码登录事务，已消费验证码并创建 session，再单独更新密码。密码写入失败后响应为 500，但 session 留存、验证码被消费，用户无法用原验证码重试。
- 请求认证器接受真实 Bearer session token，但 session 查询和 sign-out 只读取 Cookie。Bearer 客户端收到登出 204 后原 token 仍可通过认证。
- `verifyPassword` 对非十六进制或奇数长度摘要使用 `Buffer.from(..., 'hex')`，某些输入会截断为空 Buffer。随后 scrypt 派生零字节，空摘要相等导致任意密码返回 true。真实回归使用 `salt:zz` 与 `salt:0` 复现。
- 多个认证入口对非字符串 body 字段直接调用 trim 或传入 scrypt，返回 500 而非边界 400。

首轮 18 项新增回归中 12 项失败，日志为 `.creative-test-results/auth-server-red-20261115.log`。数据库回归使用独立 PostgreSQL schema 与触发器注入密码/会话写入失败，不依赖 SQL 字符串比对。

## 修复

- 新 `resetPasswordWithVerificationCode` 在同一事务内锁验证码/用户、更新密码、标记验证码、创建新会话。任一步失败全部回滚；错误返回安全文案，不暴露数据库诊断。并发同验证码只成功一次。
- session-token 解析提取为共享小模块，保持既有 Cookie 优先级。认证器、session 查询与 sign-out 对相同凭据使用一致规则；不因 Cookie 无效而回退到另一 Bearer 身份。桌面确认仍要求浏览器 Cookie，没有扩大授权方式。
- 所有 local-auth 响应及旧 magic-link 路径设置 `private, no-store` 和 `Vary: Cookie, Authorization`。
- 密码验证只接受系统自身的 32 位十六进制盐、128 位十六进制摘要格式，拒绝空摘要、截断和额外字段。正常 hashPassword 生成值保持可用。
- 请求字段先进行字符串类型检查，非法输入提前返回原有安全错误。桌面 callbackUrl 的非字符串值明确拒绝。

既有普通 magic-link 的短暂重放宽限与其他设备会话的密码重置策略未在本轮改变；此项不代表已经完成所有认证策略审计。验证码 hash 在当前 schema 中全局唯一，未把未经复现的“碰撞时删除其他邮箱代码”当成已修漏洞。

## 验证

- 最终五个文件 **36/36 通过**：新真实 PostgreSQL 边界 13、密码摘要 6、已有注册 PostgreSQL 9、密码路由 4、桌面路由 4。
- 新实库回归包括密码写入失败全回滚、会话写入失败原密码可用、同验证码并发只一次、Bearer 登出真正失效、Cookie 优先级及无缓存、八类非法输入。
- 整个 Server 类型检查退出 0。
- 新 token 模块和两份测试文件 Biome 通过；没有对两个既有大型认证文件做整体格式化，不能宣称它们既有全部格式诊断已清零。
- 限定改动 `git diff --check` 通过。

证据：`.creative-test-results/auth-server-verified-20261115.log`、`auth-server-typecheck-20261115.log`。

## 测试数据库

本轮共享临时集群 `D:/UserCache/Temp/helstera-auth-boundary-w9e9emv0` 仅监听 `127.0.0.1:50471`；随机 SCRAM 密码仅在私有 runtime JSON 中，未进入报告。public.pgcrypto 预建以避免并发 fixture 创建冲突。本子任务的 `auth_boundary_*` 和注册 fixture schema 已清理，集群仍供父代理、字幕及 credits 子任务使用，最终停止由父代理统一处理。没有重用或删除已停止的旧集群目录。

CI 应在真实 PostgreSQL 环境执行 `src/http/local-auth-boundary.postgres.test.ts`，并执行 `src/local-db/password-hash.test.ts`，不能把没有数据库的跳过记为通过。
