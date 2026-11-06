# 聊天复制与恢复验收 · 2026-11-06

功能提交 `c7535937`，分支 `codex/agent-workspace-ci`。只暂存本轮改动；原有其他源码、安装包、缓存和学习目录保留。

## 修复

- 用户和助手消息新增“复制消息”，支持中文/英文、已复制反馈及失败提示。只复制正文，不含思考块和工具内部输出。浏览器拒绝异步剪贴板API时使用原生复制备用路径；备用输入清理后恢复原焦点。
- 消息文本可聚焦、可选择；复制事件限定到所选正文，避免画布接管正文的Ctrl/Cmd+C。
- 修复重连恢复竞态：请求期间如果开始了新一轮流式回复，即使该流已经结束，旧数据库快照也不能覆盖新回答。重连初始化在正在发送新消息时不另建恢复占位。

## 验证

- 新增复制与重连回归先失败：缺少复制按钮3项、旧快照覆盖新回复1项。修复后聊天定向4文件12项通过，Web/Desktop独立类型检查退出0。
- 使用真实Electron 33.4.11和当前preload源码，独立用户目录、隐藏窗口、沙箱及contextIsolation均开启。首次加载、刷新、主动终止测试渲染进程后的恢复，以及故意错误preload的诊断全部通过：`RENDERER_HEALTH_PASSED`。未影响用户正在运行的浏览器或桌面程序。
- 新增脚本`apps/desktop/scripts/run-renderer-health.mjs`与`renderer-health-smoke.cjs`，Windows/macOS/Linux候选CI均调用；Linux使用Xvfb。
- 生产Web候选`full-web-S07roY`，68页构建成功；归档SHA-256：`01ca1a8086aa3a996c244b74abf6043ec17ce694d6958ec09448388100cec5f4`。原子替换静态目录，路由、内容哈希、缺失资源404及四Agent接口未登录401检查通过。
- 2026-11-06 23:42，在用户原画布实际点击助手“复制消息”，剪贴板内容与完整回答一致；拖选“请先选择浏览模式：”后Ctrl+C得到相同文字。原输入草稿保留，验证结束恢复此前的剪贴板文本。没有重发用户消息或调用生成模型。
- 新标签与原标签重新加载均未复现`BROWSER_SANDBOX_LOAD`初始化错误；这说明本次复查通过，不代表已修改或根治Codex宿主缺陷。

## Codex更新检查

内置更新器返回已安装`26.1029.61003`、build `24614`、distribution `prod`，状态`available`；目标版本和build均未返回。本轮只检查更新，没有安装或重启Codex。

## 证据

本机运行证据保留在`.creative-test-results/chat-copy-20261106/proof.json`、`production-copy.png`、`chat-copy-web-deploy.log`与`renderer-health-a8CzWo/health.json`。产品源码提交不包含用户截图或剪贴板内容。

Agent Closure CI `42244846244`通过，包含四端类型检查、真实PostgreSQL及新增聊天回归。首次桌面CI中Windows/macOS健康步骤通过；Linux因Electron的`chrome-sandbox`未配置root属主和4755权限而拒绝启动。提交`0e3ab844`只修正临时CI Runner的辅助程序权限，保持沙箱开启。重跑`42246219793`全部通过，包括Windows x64、macOS arm64、Linux x64健康检查与候选打包。候选构建与隔离回归不替代安装过程的真机验收。
