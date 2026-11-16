# 网站登录会话管理的请求隔离

范围是 `apps/web/src/components/agent-browser/session-manager.tsx` 和新回归 `apps/web/test/website-session-account.test.tsx`。没有修改冻结的 r25 归档、发布工具或生产服务。

## 复现与修复

组件在 token 变化后保留旧列表，旧列表请求迟到时还能覆盖新列表、展示旧错误并结束新请求的 loading。旧撤销请求在组件卸载后仍派发 `loomic:website-sessions-changed`。外层 `AgentBrowserDock` 已按 `user.id` 重建组件，所以这里不把旧列表问题表述为绕过现有跨用户屏障或后端鉴权；真实卸载后的事件问题仍会影响新页面的 JourneyComposer。

现在 token 变化会重建会话管理状态；列表读取以请求序号排除迟到的成功、失败及 finally。撤销完成须仍属于同一次组件生命周期，才修改列表、显示通知或派发刷新事件。当前生命周期的成功撤销仍只派发一次事件。正在撤销时重开面板不会另起读取，避免读取中的旧列表将已撤销项重新加回。

已发送的 DELETE 仍由服务器处理；切换账户或离开页面不会撤销服务器已经接受的操作。列表 API 没有 AbortSignal 契约，本修复隔离迟到响应，没有声称取消网络请求。

## 验证

- 初始 7 项回归有 5 项先失败、2 项原行为通过。`website-session-account-red-20261116.log` 保留原结果。
- 重开面板与撤销重叠读取的第 8 项用例另先失败，见 `website-session-reopen-red-20261116.log`。
- 最终新回归 8 项与原浏览器 Dock 5 项，合计 **13/13 通过**；`website-session-account-green-20261116.log`。
- Web TypeScript 检查通过；`website-session-account-typecheck-20261116.log`。首次检查发现新增测试中数组项可能为 undefined，已用显式错误处理修复并重新通过。
- 两个源码/测试文件 Biome 通过；限定文件 `git diff --check` 通过。

验证命令：

```powershell
node ../../node_modules/vitest/vitest.mjs run test/website-session-account.test.tsx test/agent-browser-dock.test.tsx --reporter=verbose
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
node node_modules/@biomejs/biome/bin/biome check apps/web/src/components/agent-browser/session-manager.tsx apps/web/test/website-session-account.test.tsx
```

## 当前全仓诊断

直接运行等价 `biome check . --reporter=json --max-diagnostics=none`，退出 1：**1,724 个文件、5,697 项错误、1 项警告**。这是本轮修改后的当前快照，不能把 5,752 当作精确剩余值。无规则关闭、无全仓自动格式化。

- 格式 1,603、导入排序 824：适合后续按目录和明确文件所有权做机械收敛，当前不重排大量 dirty 源文件。
- 非空断言 1,079、单声明 603、显式 any 462：先检查真实边界和远程适配器契约，不能统一替换为断言或 unknown 来掩盖风险。
- Effect 依赖 186 项、79 个文件：既有大量 retry/revision 等刻意重载依赖；逐条结合异步账户/请求语义复核，不能删依赖只为消诊断。本轮会话管理的两个依赖诊断随实际生命周期修复一起清除。
- 语义元素 184、无 SVG title 76、无 label control 67、button type 40，以及媒体字幕 20 等可访问性诊断仍在；真实字幕缺少来源契约，不能用空轨伪造。
- 唯一警告是 `visualforge-workspace.tsx` 中一条无效 suppression；未顺手修改他人文件。

机器摘要：`.creative-test-results/biome-quality-summary-20261116.json`；完整当前诊断：`biome-quality-after-session-20261116.json`。全仓 lint、全量 Web 重跑、生产登录后操作与新代码发布仍未由本子任务证明完成。
