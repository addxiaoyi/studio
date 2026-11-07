# 试穿计费与基础组件验收（2026-11-07）

本轮覆盖原版女装试穿工作台和全站表单组件。模型选择同时显示价格、参考图能力、分辨率及不可用原因；每次试穿绑定两张私有参考图与所选模型，确认前不创建生成任务、不扣费。结果取回失败保留原任务，刷新后继续下载，不重复生成。

## 修复与边界

- 模型目录为空时不再回退到未配置的内置模型。Token 模型标明积分预占和按实际用量结算。
- 线上验收发现 `gpt-image-2` 目录价格为 0.05 积分，而旧报价服务查询另一供应商，返回 0.1。试穿报价改为取实际选中的健康路由价格；费用指纹包含模型参数、参考素材和报价。
- 免费试穿仍须逐次确认；新增增量迁移允许 0 积分确认，工作队列仅放行已明确确认的免费任务，付费任务先完成积分预占。
- 拒绝/过期报价不能启动任务；已确认或不存在的报价不会错误返回“取消成功”。取消费用确认不再显示生成失败弹窗。
- 选择器统一使用 Base UI 的浮层、键盘导航、禁用状态和边界避让；原生 dialog 内的菜单挂载在该弹窗中。下拉菜单、子菜单、输入框与弹窗使用主题实底，去除透底玻璃效果。
- 此次发布没有执行付费真人照片生成。浏览器生成成功与下载恢复用注入的 API 验证；真实 PostgreSQL 验证了审批、任务与积分事务，不等同于上游模型出图质量验收。

## 可复现验证

1. `node scripts/prepare-creative-sources.mjs fashion`
2. `node scripts/build-fashion-runtime.mjs`：从锁定提交 `fd4fe6dfc9c3938969243a0733960b222a7c57c5` 构建运行时、图集目录与公开图片，保留版权文本。
3. `node scripts/test-local-postgres.mjs src/features/generation/fashion-billing.postgres.test.ts src/http/fashion-billing.test.ts src/http/image-models-route.test.ts src/http/media-connector-gate.test.ts src/http/generation-approvals.test.ts src/features/generation/generation-approval-service.test.ts`：24 项通过，包括真实数据库的 6 项验收。
4. Web 的试穿、选择器、素材导入、OneTake 导出、桌面助手和市场测试：66 项通过；独立待提交目录中的画布试穿、费用设置交接、图集和桌面导航测试另有 29 项通过。
5. `pnpm --filter @helstera/web exec playwright test --config playwright.fashion-billing.config.ts`：4 项通过，覆盖拒绝后重新报价、结果下载失败后刷新恢复、320px 深浅主题、200% 浏览器缩放等效 CSS 视口与键盘选项提交。
6. Shared 构建及 Server/Web/Desktop 类型检查退出码均为 0。仅包含待提交内容的独立目录完成 Shared 构建、Web 类型检查，排除依赖未提交文件的情况。

原始本地证据保留在 `.creative-test-results/fashion-server-final.log`、`fashion-web-final-tests.log`、`fashion-index-tests.log`、`fashion-billing.json` 及 `fashion-billing/`。回归已接入根目录 `Agent Closure CI`，不能用历史 CI 的成功状态代替本次运行结果。

## 生产交付

- 静态候选 `release-candidates/full-web-pHfWu0`：68 个页面导出，增量归档 1,481,109 字节；上线前核对 3,247 个文件 SHA-256。原子交换后路由、静态文件哈希、缺失资源 404 与 API health 通过。
- Server 仅更新试穿参数校验、模型目录、审批服务和任务计费门禁；发布前确认无运行或排队中的媒体任务。迁移在事务内执行，锁等待上限 5 秒；没有清理用户素材、浏览器或已有候选包。
- Server 第二次增量修复取价差异，健康检查返回 `ok: true`，未登录调用图像任务接口返回 401。
- 后续上线运行时补丁消除取消失败弹窗并调整请求处理中提示；具体哈希、线上报价与拒绝结果在最终验收段记录。

## 最终线上验收

已登录生产浏览器用两张公开图集样例测试：选择 GPT Image-2 时目录显示 **0.05 积分/张**，服务端确认弹窗同样显示 **0.05 积分**。拒绝后正常回到工作台，显示“本次报价已拒绝，没有启动生成或扣费”，余额不变，错误弹窗不可见。未点击付费生成。

最后运行时 SHA-256：`9e493a579515f6d8a44a4b83a74c77b87c144de2608a36d56d500c12a629d10d`。线上报价截图保存在本地 `.creative-test-results/fashion-production-quote.png`，不上传账户界面截图到公共仓库。

补充运行真实 PostgreSQL 私有试穿素材测试：1 项通过，覆盖幂等回存、跨用户拒绝、到期与删除后不可读取；同文件的视频测试因本轮未提供视频文件而跳过，不能记为视频验收通过。
