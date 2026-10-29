# 聊天消息重复：根因修复记录（清单第 1 批）

范围：清单「聊天与消息流」第 1–4、41–48 项中可由代码与测试闭环的部分。
状态含义：`已修复` 有本轮改动 + 自动化证据；`已有防护` 代码已有实现并定位到行；`需运行时证据` 静态可确认但必须真机复验；`未处理` 本轮未碰。

## 症状

首次提交后用户消息可能重复显示；历史里出现连续重复消息。此前两版修复都停在「读取时折叠」，属于掩盖：重复行早已写进 `chat_messages`。

## 根因

- 前端 `chat-sidebar.tsx` 先乐观插入 `user-${Date.now()}`，再 fire-and-forget `saveMessage`；失败只 `console.error`，无重试、无幂等。
- 服务端 `features/chat/chat-service.ts`（远端 Supabase）与 `local-db/chat-service.ts`（本地 Postgres）都直接 `insert`，没有请求标识，也没有唯一键。
- 契约 `packages/shared/src/contracts.ts` 的 `chatMessageCreateRequestSchema` 没有请求 ID 字段。
- 结果：路由重载、重连、手工重试、双端保存任何一条路径都会插入第二行；读取折叠只在「连续 + 同 role + 同 content」时生效。

## 改动

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 契约 | `packages/shared/src/contracts.ts` | `chatMessageCreateRequestSchema` 增加可选 `clientMessageId`（trim，1–128） |
| 远端库 | `supabase/migrations/20261028000000_chat_message_idempotency.sql` | 新增 `client_message_id text` 列 + `(session_id, client_message_id)` 唯一索引 |
| 本地库 | `apps/server/src/local-db/schema.sql` 与 `local-db/migrations/20261028000000_chat_message_idempotency.sql` | 同上（新装走 schema，已有库走迁移） |
| 远端服务 | `apps/server/src/features/chat/chat-service.ts` | 抽出 `toChatMessage`；插入带 `client_message_id`；唯一键冲突（`23505`/duplicate）时回查既有消息并返回，实现幂等重放 |
| 本地服务 | `apps/server/src/local-db/chat-service.ts` | 先按 `clientMessageId` 查 → 未命中 `insert ... on conflict do nothing returning` → returning 为空再回查 → 仍空报 500 |
| 前端 | `apps/web/src/components/chat-sidebar.tsx` | 主发送路径复用已有 `requestId` 作为 `clientMessageId`；直连视频路径新增 `crypto.randomUUID()` |

本地折叠条件同时与远端对齐（删掉本地多出的 `content.length === 0` 分支），消除清单第 43 项的格式不一致。

## 证据

```
apps/server  110 文件 / 572 用例 → 112 文件 / 578 用例  全部通过（新增 2 文件 6 用例）
apps/web     98 文件 / 329 用例 全部通过；chat-sidebar 3 用例含 clientMessageId 断言
apps/desktop 12 文件 / 58 用例 全部通过
server / web tsc --noEmit 均 EXIT 0（需先构建 packages/shared 的 dist）
```

新增用例覆盖：正常插入；同 `clientMessageId` 重试命中唯一键冲突后返回既有消息 id 且不抛错；不同 id 正常插入；本地库「已存在直接返回不 insert」「returning 为空回查」；连续同 role 同 content（含空 content）折叠。

## 未覆盖风险

- 迁移未对真实 Postgres / 远端 Supabase 执行，`on conflict do nothing` 的真实并发行为未压测。
- 未启动 dev server 做浏览器端手工复现；`ws/handler.ts` 的助手消息持久化路径（清单第 47 项）仍只 `log.warn` 吞掉失败，没有重试。
- 冷检出若未先构建 `@helstera/shared`，`tsc` 会因 dist 陈旧报 `clientMessageId` 不存在（既有构建顺序问题）。

## 回滚

代码与迁移彼此独立：回滚前端传参即回到旧行为（旧行 `client_message_id` 为 NULL，不冲突）；唯一索引与旧数据兼容。
