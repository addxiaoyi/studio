# 工作流柔和连线

将两点直线替换为采样三次曲线，保留Excalidraw原生箭头及绑定。节点之间水平空间足够时从相对侧边出入，上下排列时改从上下边缘连接；反向连接使用面对彼此的边缘。端点方向平滑过渡，使用较轻的中性色线条。交付结果的虚线采用同一几何规则。

拖动或缩放节点时按动画帧刷新几何，不再等工作流120ms保存同步才校正。只处理带工作流标识的箭头，普通画布连线不变。刷新不增加撤销记录，不创建生成任务、不触碰计费。

单元测试16项通过，覆盖水平/上下/反向排列、重合及旋转节点、坐标范围、刷新幂等、原生场景投影和素材嵌入。Web类型检查、静态生产构建通过。Chromium已验证节点拖动、撤销重做、保存刷新和连线关系恢复（42.6秒）。Windows 0.2.21隔离候选进一步验证曲线命中选择、Delete删除、原生撤销恢复、设置面板断开/撤销和保存，1条通过（51.9秒）；同版素材拖入测试通过（13.9秒）。测试未创建生成任务。

证据日志：`M:/loomic-builds/workflow-curves-browser.log`、`workflow-curves-desktop-review.log`、`workflow-curves-web-build.log`。截图位于 `Loomic/.creative-test-results/workflow/workflow-curves-curved-wir-1adfb-ve-native-undo-and-deletion/workflow-curves-final.png`。

实现提交 `57237e2` 已推送并发布到生产Web；本轮无需Server重启或数据库迁移。发布校验3250个文件，画布、视频、女装、桌面Web路由均返回200，服务健康。线上与候选画布HTML SHA256一致：`fb01d0c101fa5e51cd523d86da2054d97cdd25f3b29ac2db492d00ac8e1d3880`。

在独立的新标签中打开用户原画布，确认“机器人花园分镜”的斜向连接与结果虚线显示为曲线，并保留原标签和本机未保存草稿提示。未恢复或丢弃用户草稿，未触发费用确认。生产截图为 `M:/loomic-builds/workflow-curves-live.png`；发布日志与哈希记录为 `M:/loomic-builds/publish-workflow-curves-web.log`、`workflow-curves-production-check.json`。
