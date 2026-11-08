# 画布面板、文稿和动效修复

根据用户对同一生产画布的四处标注完成以下调整：

- 时间线只在点击画布空白位置时收起，点击素材、编辑控件、拖动或平移画布不误关。收起保留未提交字幕草稿，停止播放并恢复字幕透明度；空白点击不抢回工具栏焦点。
- 工作流面板固定在左侧悬浮，宽屏时保留右侧AI对话。窄屏改为左下紧凑面板；流程打开时避免手机全屏聊天遮住画布，宽屏不自动关闭聊天。
- 新生成的剧本/分镜交付为可编辑文稿卡，用现有安全Markdown渲染显示标题、加粗、列表和正文。旧的 `workflow-text:` 文本元素自动转成同ID文稿卡，保留位置、原文、素材来源及连线；普通用户文字和字幕不转换。
- 节点结果摘要也渲染Markdown。文稿支持选字复制和编辑，保存参与原画布撤销和自动保存；编辑期间源内容变化会报冲突，不覆盖别人的更新。
- 使用GSAP实现短距离面板入场/退出及视野定位，支持打断和减少动态效果偏好。定位节点/结果会扣除左侧悬浮面板占用区域，避免文稿被面板挡住。

## 验收

新增回归先失败后通过：旧Markdown文稿转换、普通文字不变、空白点击/图形点击/拖动区别、文稿排版和编辑回执。Shared相关5项、时间线与文稿组件5项通过，Server/Web类型检查通过。

真实Chromium四条端到端通过（约1.1分钟）：原流程执行与刷新、分镜文稿、左流程与右聊天共存、时间线空白收起并保留字幕、Inspire资源库和选区引用。Windows 0.2.21候选在隔离用户目录重复相同流程，4项全部通过（1.1分钟），日志为 `M:/loomic-builds/canvas-natural-desktop-final.log`。

代码路径：`components/canvas/workflow-document.tsx`、`hooks/use-canvas-dismiss.ts`、`hooks/use-floating-panel.ts`、`components/workflow/viewport.ts`、`packages/shared/src/canvas-document.ts`。动效使用已安装GSAP，未引入新的运行依赖。

本轮继续保留Inspire-Studio个人资源库、提示词库、AI引用和历史结果对比；没有回退前一轮功能。

## 生产发布与实际验收

- 实现提交 `e802184e61bdab66a752c22db04176af365d701c` 已推送 `codex/agent-workspace-ci`。在生产现有版本上增量发布，保留线上视频、登录和七牛云配置；Server及Web发布脚本分别返回 `FUSION_SERVER_DEPLOYED`、`WORKFLOW_WEB_DEPLOYED`。
- 在用户已登录的原画布验证：旧分镜正常显示标题和段落；编辑按钮打开原始文稿，取消不会改写内容；1703px宽屏下左侧流程与右侧AI对话共存；定位结果后文稿不被左面板遮住；打开媒体时间线后点击画布空白处，时间线关闭。临时浏览器尺寸已恢复。
- 生产截图：`M:/loomic-builds/canvas-polish-live.png`。部署日志：`M:/loomic-builds/deploy-canvas-natural.log`、`M:/loomic-builds/publish-canvas-natural-web.log`。最终只读检查：`M:/loomic-builds/inspire-production-final.log`，退出码0，Server/Worker均为 `online`，健康接口 `ok:true`。
- `/canvas/`、`/video/`、`/fashion-gallery/`、`/desktop-app/` 均返回200。生产画布HTML SHA256为 `8e8158abc3a3706d15984a82c1de22cc7bb17a57a39b3b1de566bfea5fc1c332`。
- 当前实现的 [Agent Closure CI](https://github.com/addxiaoyi/studio/actions/runs/42473412057) 与 [Website Capture CI](https://github.com/addxiaoyi/studio/actions/runs/42473412004) 已通过。[Desktop Candidate CI](https://github.com/addxiaoyi/studio/actions/runs/42473412017) 截至记录时仍在安装构建依赖，不能将本地Windows验收当作此次跨平台打包通过的证据。
