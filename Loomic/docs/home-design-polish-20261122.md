# 首页审美细节优化

使用用户指定的 [UI UX Pro Max skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)。已安装到本机 Codex skills，采用其匹配的 Heading Hierarchy、Friendly SaaS 及布局一致性建议；本轮保留现有字体资源和应用色彩 token，针对当前首页做细节调整。

- 调整标题、说明和主输入框的字号、行高、边距与焦点边界，补齐系统无衬线字体回退。
- 为四个快捷入口增加同一套装饰性线性图标，统一标题、说明和间距。
- 将“新建项目”由高对比大卡片移到最近项目标题栏，四个实际项目形成整齐网格。
- 项目名称支持两行，日期与画布名称另排一行；降低占位预览的装饰强度，保留真实预览与失败状态。
- 加入空项目提示，并使加载骨架与最终网格对应；新建、项目访问、移到回收站和取消操作沿用原业务逻辑。
- 320px 下内容重排、输入字号不低于 16px；深色快捷入口显式使用前景色，避免链接标题继承黑色。

## 验证

本地隔离项目数据完成 Chromium 的 1440 / 768 / 320px、浅色 / 深色、项目访问、删除弹窗取消、空列表、服务失败和重试检查。快捷入口标题及说明文字在两种主题下测得对比不低于 4.5:1。现有首页组件回归 9 项通过，新增首页浏览器场景通过，类型检查通过。未宣称完成原生 200% 缩放或读屏验收。

运行方式：设置显式本地 `DATABASE_URL` 后，执行 `pnpm --filter @helstera/web exec playwright test --config playwright.workflow.config.ts home-design.spec.ts`。

预览截图位于 `.creative-test-results/workflow/home-design-home-polish-pr-93f7c-esponsive-light-dark-states/`。这是本地演示数据预览；当前生产页面没有因本轮源代码修改而更新。
