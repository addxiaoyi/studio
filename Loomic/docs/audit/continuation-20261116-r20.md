# 2026-11-16 r20 task account boundary

工作树：`D:/qwq/项目/scpit/.codex-worktrees/Loomic-continuation-20261112/Loomic`；分支：`codex/production-closure-20261115`。

## 已修复与验证

任务详情在同 token 切换账户后仍保留旧账户状态，迟到的 JSON 导出也会继续触发浏览器下载。新增回归先复现此行为。`ToolBlockView` 现按 user id、session token 和 tool call 隔离内部视图；详情关闭或账户变化后，迟到的取消、同步、导出响应不会更新状态、刷新任务或触发下载。已创建的 Blob URL 即使点击下载抛错也会释放。

取消请求提交成功后的等待提示由当前任务 `stage` 推导，通过语义化 `output` 展示；真实操作错误仍使用 alert。原取消和未退款文案断言保留，并增加“成功请求不显示为错误”检查。

- 任务卡回归 15/15，通过退出码 0；新增两项覆盖同 token 切换账户后旧取消响应、旧导出响应。
- Web 全量 227 个文件、920/920 项通过，退出码 0；日志：`.creative-test-results/web-account-isolation-final-20261116.log`。
- Web typecheck 通过；production build 68 页静态导出通过；日志：`.creative-test-results/web-account-isolation-build-20261116.log`。
- r20 实际提取 Shared 副本后的 parity 套件 6/6 通过；日志：`.creative-test-results/shared-r20-parity-20261116.log`。
- 修改文件 `git diff --check` 通过。`tool-block-view.tsx` 仍有 37 项 Biome 诊断，本轮未将整个文件格式化或宣称 lint-clean。

## 候选及边界

候选 `.codex-release/production-closure-20261116-r20.zip`：4,361 个条目、166,512,679 字节；SHA-256 `ef3bc8c2d8594f2bb37b4da276acbe71d31fc5f719998ecad30aab807d9c80f0`。manifest、路径安全、全文件摘要、提取树、Creative runtime、Server 归档源码与当前工作树字节比较、Shared 两份 dist 比较均通过；`deployed: false`。脚本与收据位于 `.creative-test-results/verify-r20.py`、`candidate-r20-verified-20261116.json`。

Server 最新分组证据仍见 r19：1,362 项通过，真实 Electron fixture 在连接前退出 `2147483651`，未通过。本轮读取此前诊断：同一官方 Electron 在应用 JS 执行前，于 Chromium sandbox broker 创建备用窗口站处触发断点，系统返回 ACCESS_DENIED。该诊断说明当前环境限制，不能用它代替实际 Electron 通过证据；未修改 sandbox、Windows ACL 或全局权限。

生产凭据本轮仍未设置，生产日志、Qiniu 502 根因、部署及迁移/容量/媒体/认证/回滚验收未完成。最近线上只读证据为 r19 的 2026-11-16 08:19 UTC 响应：旧版本、readiness 缺少 publicMedia、有效图库图片 502。全仓 Biome 和字幕来源数据契约仍未闭环。临时数据库服务已停止，目录删除被策略拒绝的状态见 r19；本轮未再尝试删除。
