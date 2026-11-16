# 2026-11-16 r21 settlement decision isolation

工作树：`D:/qwq/项目/scpit/.codex-worktrees/Loomic-continuation-20261112/Loomic`；分支：`codex/production-closure-20261115`。

## 修复

结算决定提交后，原组件在账户、任务或报价改变时仍保留旧 busy 状态，旧请求失败也会把错误写入新账户界面。连续点击可在 React 提交 busy 状态前发出两次请求。新增五项回归先复现这些失败，原有准确 review id 和可重试错误断言保留。

`JobSettlementReview` 新增明确的 `userId` 输入，聊天与视频素材生成两个调用点均已接入；内部决定状态按 user id、token、job id、review id 隔离。同步 ref 锁阻止同一决定重复提交；组件失效后，迟到响应不再调用旧刷新回调、设置错误或解除新决定的 busy 状态。聊天内刷新结算任务时也再次检查详情面板是否有效。

已提交的决定仍由服务端按原请求处理；客户端不会因账户切换声称已撤回服务端决定。本轮不改变账本、扣款或服务端幂等实现。

## 验证

- 结算与任务卡定向测试 22/22 通过；其中结算 7 项、任务卡 15 项。
- Web 全量 227 文件、925/925 项通过，退出码 0。日志：`.creative-test-results/web-settlement-boundaries-final-20261116.log`。
- Web typecheck 通过；production build 68 页静态导出通过。构建日志：`.creative-test-results/web-settlement-boundaries-build-20261116.log`。
- 结算组件与测试文件通过 Biome；4 个修改文件通过 `git diff --check`。这不代表全仓 Biome 已通过。
- r21：`.codex-release/production-closure-20261116-r21.zip`，4,361 条目、166,512,811 字节，SHA-256 `b6b5afcc520d6ddf41dd6478821dc9b89aeb68066c98caa886be55e338b3f2b7`。manifest、路径、摘要、提取树、Creative runtime、Server 归档源码与当前工作树字节比较、Shared 两份 dist 比较均通过。收据：`.creative-test-results/candidate-r21-verified-20261116.json`；验证脚本：`.creative-test-results/verify-r21.py`；`deployed: false`。

## 最新生产连接证据

本轮使用 `BatchMode=yes`、禁用密码提示、保留严格 host key 检查进行只读连接测试。SSH agent 当前有密钥；跳板 `103.40.14.25:19198` 的 `add` 身份密钥认证成功，`id -un` 返回 add，退出码 0。目标 `23.251.32.222:22` 直连超时；经跳板能到达目标机，但 root 身份认证返回 `Permission denied (publickey,password)`，退出码 1。`HELT_DEPLOY_PASSWORD` 未设置。未读取生产配置或日志，未部署、迁移或重启。

Qiniu 502 根因与生产验收仍缺失；此前 Electron 在当前环境的 sandbox 初始化失败，未通过真实回执恢复测试。全仓 Biome 与字幕数据契约仍未闭环，目标未完成。
